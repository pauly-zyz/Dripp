import { and, desc, eq, lt } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { app } from "../db.ts";
import { HttpError } from "../util.ts";
import type { Deps } from "./context.ts";
import { getMarket } from "./markets.ts";

/** Message signed (EIP-191, or ERC-1271 for smart wallets) to post a comment. */
export const commentMessage = (series: string, timestamp: number, body: string) =>
  `Dripp comment\nSeries: ${series}\nTimestamp: ${timestamp}\n\n${body}`;

const MAX_CLOCK_SKEW_S = 300;
const URL_RE = /https?:\/\/\S+/gi;

/** Basic moderation: trims, collapses blank lines, enforces length, banned words and link spam. */
export function moderate(body: string, opts: { maxLength: number; bannedWords: string[] }): string {
  const clean = body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (clean.length === 0) throw new HttpError(422, "empty comment");
  if (clean.length > opts.maxLength) throw new HttpError(422, `comment longer than ${opts.maxLength} characters`);
  const lower = clean.toLowerCase();
  if (opts.bannedWords.some((w) => lower.includes(w))) throw new HttpError(422, "comment contains a banned word");
  if ((clean.match(URL_RE) ?? []).length > 1) throw new HttpError(422, "too many links");
  return clean;
}

export async function listComments(deps: Deps, seriesId: string, q: { limit?: number; before?: number }) {
  const m = await getMarket(deps, seriesId);
  const { comments } = app;
  const rows = await deps.db
    .select()
    .from(comments)
    .where(
      and(eq(comments.series, m.series), eq(comments.hidden, false), q.before ? lt(comments.id, q.before) : undefined),
    )
    .orderBy(desc(comments.id))
    .limit(Math.min(q.limit ?? 50, 200));
  return {
    series: m.series,
    comments: rows.map((c) => ({ id: c.id, author: c.author, body: c.body, createdAt: c.createdAt.toISOString() })),
    nextBefore: rows.length ? rows[rows.length - 1]!.id : null,
  };
}

export async function postComment(
  deps: Deps,
  seriesId: string,
  input: { author: Address; body: string; timestamp: number; signature: Hex },
) {
  const m = await getMarket(deps, seriesId);
  const cfg = deps.config.comments;
  const nowS = Math.floor(Date.now() / 1000);
  if (Math.abs(nowS - input.timestamp) > MAX_CLOCK_SKEW_S) throw new HttpError(400, "stale or future timestamp");

  const ok = await deps.chain.client.verifyMessage({
    address: input.author,
    message: commentMessage(m.series, input.timestamp, input.body),
    signature: input.signature,
  });
  if (!ok) throw new HttpError(401, "invalid signature");

  const [banned] = await deps.db.select().from(app.bannedWallets).where(eq(app.bannedWallets.address, input.author));
  if (banned) throw new HttpError(403, "wallet is banned from commenting");

  const body = moderate(input.body, cfg);

  // Rate limit per wallet: one comment per interval, and a daily cap.
  const burst = await deps.cache.incr(`rl:comment:burst:${input.author}`, cfg.minIntervalSeconds);
  if (burst > 1) throw new HttpError(429, `wait ${cfg.minIntervalSeconds}s between comments`);
  const daily = await deps.cache.incr(`rl:comment:day:${input.author}`, 86_400);
  if (daily > cfg.maxPerDay) throw new HttpError(429, "daily comment limit reached");

  try {
    const [row] = await deps.db
      .insert(app.comments)
      .values({
        series: m.series,
        author: input.author,
        body,
        signature: input.signature,
        signedAt: new Date(input.timestamp * 1000),
      })
      .returning();
    return { id: row!.id, series: m.series, author: row!.author, body: row!.body, createdAt: row!.createdAt.toISOString() };
  } catch (e) {
    if (String((e as { code?: string }).code) === "23505") throw new HttpError(409, "duplicate comment");
    throw e;
  }
}

export async function hideComment(deps: Deps, id: number, reason: string | undefined) {
  const [row] = await deps.db
    .update(app.comments)
    .set({ hidden: true, hiddenReason: reason ?? "moderation" })
    .where(eq(app.comments.id, id))
    .returning();
  if (!row) throw new HttpError(404, "comment not found");
  return { id, hidden: true };
}

export async function banWallet(deps: Deps, address: Address, reason: string | undefined) {
  await deps.db
    .insert(app.bannedWallets)
    .values({ address, reason })
    .onConflictDoUpdate({ target: app.bannedWallets.address, set: { reason } });
  return { address, banned: true };
}
