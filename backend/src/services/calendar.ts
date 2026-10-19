import { and, asc, eq, gte, lte } from "drizzle-orm";
import { classifyMultiplierChange, dividendFraction } from "@dripp/shared";
import { app, ponder } from "../db.ts";
import { isoDate, str, wadToNumber } from "../util.ts";
import type { Deps } from "./context.ts";
import { chainNow } from "./markets.ts";

/**
 * Ex-dividend calendar ("kalender ex-dividen") per stock, merged from:
 * - "scheduled": ERC-8056 UIMultiplierUpdated announcements whose effectiveAt is still ahead (on-chain);
 * - "announced": corporate actions entered by the team (POST /admin/corporate-actions);
 * - "proposed" / "confirmed" / "disputed": DividendOracle proposals (dated by proposal time).
 */
export interface CalendarEntry {
  date: string;
  timestamp: number;
  stockToken: string;
  ticker: string | null;
  type: "scheduled" | "announced" | "proposed" | "confirmed" | "disputed";
  kind: "dividend" | "split" | "mixed" | "unknown";
  dividendPct: number | null;
  splitRatio: number | null;
  fromMultiplier: string | null;
  toMultiplier: string | null;
  source: "erc8056" | "team" | "oracle";
  txHash: string | null;
  note: string | null;
}

export interface CalendarQuery {
  stock?: string;
  from?: number;
  to?: number;
}

const DAY = 86_400;

export async function getCalendar(deps: Deps, q: CalendarQuery = {}): Promise<CalendarEntry[]> {
  const { db } = deps;
  const now = await chainNow(deps);
  const from = q.from ?? now - 90 * DAY;
  const to = q.to ?? now + 180 * DAY;
  const stocks = await db.select().from(ponder.stockToken);
  const wanted = q.stock?.toLowerCase();
  const selected = stocks.filter((s) => !wanted || s.address === wanted || s.ticker?.toLowerCase() === wanted);
  const tokens = new Set(selected.map((s) => s.address));
  const ticker = new Map(selected.map((s) => [s.address, s.ticker]));
  if (tokens.size === 0) return [];

  const { multiplierUpdate: mu, proposal: pr } = ponder;
  const { corporateActions: ca } = app;
  const [updates, proposals, actions] = await Promise.all([
    db
      .select()
      .from(mu)
      .where(and(eq(mu.cancelled, false), gte(mu.effectiveAt, BigInt(Math.max(from, now + 1))), lte(mu.effectiveAt, BigInt(to))))
      .orderBy(asc(mu.effectiveAt)),
    db
      .select()
      .from(pr)
      .where(and(gte(pr.proposedAt, BigInt(from)), lte(pr.proposedAt, BigInt(to))))
      .orderBy(asc(pr.proposedAt)),
    db
      .select()
      .from(ca)
      .where(and(gte(ca.exDate, new Date(from * 1000)), lte(ca.exDate, new Date(to * 1000))))
      .orderBy(asc(ca.exDate)),
  ]);

  const entries: CalendarEntry[] = [];
  for (const u of updates) {
    if (!tokens.has(u.stockToken)) continue;
    const c = classifyMultiplierChange(u.oldMultiplier, u.newMultiplier);
    const ratio = Number((u.newMultiplier * 10n ** 18n) / u.oldMultiplier) / 1e18;
    entries.push({
      date: isoDate(u.effectiveAt),
      timestamp: Number(u.effectiveAt),
      stockToken: u.stockToken,
      ticker: ticker.get(u.stockToken) ?? null,
      type: "scheduled",
      kind: c.kind === "ambiguous" ? "unknown" : c.kind,
      dividendPct: c.kind === "dividend" ? (ratio - 1) * 100 : null,
      splitRatio: c.kind === "split" ? ratio : c.kind === "mixed" ? wadToNumber(c.splitRatio) : null,
      fromMultiplier: str(u.oldMultiplier),
      toMultiplier: str(u.newMultiplier),
      source: "erc8056",
      txHash: u.txHash,
      note: null,
    });
  }
  for (const a of actions) {
    if (!tokens.has(a.stockToken as `0x${string}`)) continue;
    entries.push({
      date: a.exDate.toISOString(),
      timestamp: Math.floor(a.exDate.getTime() / 1000),
      stockToken: a.stockToken,
      ticker: ticker.get(a.stockToken as `0x${string}`) ?? null,
      type: "announced",
      kind: a.kind as "dividend" | "split",
      dividendPct: null,
      splitRatio: a.ratioNum && a.ratioDen ? a.ratioNum / a.ratioDen : null,
      fromMultiplier: null,
      toMultiplier: null,
      source: "team",
      txHash: a.proposalTx,
      note: [a.amountUsd ? `$${a.amountUsd} per share` : null, a.note].filter(Boolean).join(" · ") || null,
    });
  }
  for (const p of proposals) {
    if (!tokens.has(p.stockToken)) continue;
    entries.push({
      date: isoDate(p.proposedAt),
      timestamp: Number(p.proposedAt),
      stockToken: p.stockToken,
      ticker: ticker.get(p.stockToken) ?? null,
      type: p.status === "pending" ? "proposed" : (p.status as "confirmed" | "disputed"),
      kind: p.kind as "dividend" | "split" | "mixed",
      dividendPct: p.kind === "split" ? null : dividendFraction(p.dividendIndexBefore, p.dividendIndexAfter) * 100,
      splitRatio: p.kind === "dividend" ? null : wadToNumber(p.splitRatio),
      fromMultiplier: str(p.fromMultiplier),
      toMultiplier: str(p.toMultiplier),
      source: "oracle",
      txHash: p.txHash,
      note: null,
    });
  }
  return entries.sort((a, b) => a.timestamp - b.timestamp);
}

