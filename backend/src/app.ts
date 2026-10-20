import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { Address, Hex } from "viem";
import { app as appTables } from "./db.ts";
import { HttpError, parseAddress } from "./util.ts";
import type { Deps } from "./services/context.ts";
import { getMarketDetail, getMarkets } from "./services/markets.ts";
import { getCalendar } from "./services/calendar.ts";
import { getClaimable, getPortfolio } from "./services/portfolio.ts";
import { getProposals } from "./services/oracle.ts";
import { getLeaderboard, getReferralInfo } from "./services/leaderboard.ts";
import { registerReferral } from "./services/referrals.ts";
import { banWallet, hideComment, listComments, postComment } from "./services/comments.ts";
import { getQuote } from "./services/quote.ts";
import { getProtocol } from "./services/protocol.ts";

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const address = z.string().transform((v, ctx) => {
  try {
    return parseAddress(v);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid address" });
    return z.NEVER;
  }
});

const toUnix = (v: string | undefined) => {
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n)) return n > 1e12 ? Math.floor(n / 1000) : n;
  const d = Date.parse(v);
  if (Number.isNaN(d)) throw new HttpError(400, `invalid date ${v}`);
  return Math.floor(d / 1000);
};

const int = (v: string | undefined) => (v === undefined ? undefined : Number.parseInt(v, 10) || undefined);

async function body<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  const raw = await c.req.json().catch(() => {
    throw new HttpError(400, "invalid JSON body");
  });
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

export function createApp(deps: Deps) {
  const app = new Hono();
  app.use("*", cors());

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });

  const requireAdmin = (c: Context) => {
    const key = deps.config.adminApiKey;
    if (!key || c.req.header("x-admin-key") !== key) throw new HttpError(401, "admin key required");
  };

  app.get("/health", (c) => c.json({ ok: true }));

  // ---------------- markets ----------------
  app.get("/markets", async (c) => {
    const status = c.req.query("status");
    return c.json(
      await getMarkets(deps, {
        stock: c.req.query("stock"),
        maturity: c.req.query("maturity"),
        status: status === "active" || status === "matured" ? status : undefined,
      }),
    );
  });
  app.get("/markets/:series", async (c) => c.json(await getMarketDetail(deps, c.req.param("series"))));

  // ---------------- protocol / quotes ----------------
  app.get("/protocol", async (c) => c.json(await getProtocol(deps)));
  app.get("/quote", async (c) => {
    const q = z
      .object({
        series: z.string().min(1),
        side: z.enum(["buy", "sell"]),
        asset: z.enum(["PT", "YT", "PY"]),
        token: z.enum(["ETH", "USDG", "STOCK"]),
        amount: z.string().regex(/^\d+$/),
        slippageBps: z.coerce.number().int().default(50),
      })
      .safeParse(c.req.query());
    if (!q.success) throw new HttpError(400, q.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    return c.json(await getQuote(deps, { ...q.data, amount: BigInt(q.data.amount) }));
  });

  // ---------------- comments ----------------
  app.get("/markets/:series/comments", async (c) =>
    c.json(await listComments(deps, c.req.param("series"), { limit: int(c.req.query("limit")), before: int(c.req.query("before")) })),
  );
  app.post("/markets/:series/comments", async (c) => {
    const b = await body(
      c,
      z.object({ author: address, body: z.string(), timestamp: z.number().int(), signature: hex }),
    );
    return c.json(
      await postComment(deps, c.req.param("series"), { ...b, author: b.author as Address, signature: b.signature as Hex }),
      201,
    );
  });

  // ---------------- calendar / oracle ----------------
  app.get("/calendar", async (c) =>
    c.json(
      await getCalendar(deps, { stock: c.req.query("stock"), from: toUnix(c.req.query("from")), to: toUnix(c.req.query("to")) }),
    ),
  );
  app.get("/oracle/proposals", async (c) =>
    c.json(
      await getProposals(deps, { status: c.req.query("status"), stock: c.req.query("stock"), limit: int(c.req.query("limit")) }),
    ),
  );

  // ---------------- users ----------------
  app.get("/users/:address/portfolio", async (c) => c.json(await getPortfolio(deps, parseAddress(c.req.param("address")))));
  app.get("/users/:address/claimable", async (c) => c.json(await getClaimable(deps, parseAddress(c.req.param("address")))));

  // ---------------- growth ----------------
  app.get("/leaderboard", async (c) =>
    c.json(await getLeaderboard(deps, { metric: c.req.query("metric"), limit: int(c.req.query("limit")) })),
  );
  app.get("/referrals/:address", async (c) => c.json(await getReferralInfo(deps, parseAddress(c.req.param("address")))));
  app.post("/referrals", async (c) => {
    const b = await body(c, z.object({ referee: address, referrer: address, signature: hex }));
    return c.json(await registerReferral(deps, b.referee as Address, b.referrer as Address, b.signature as Hex), 201);
  });

  // ---------------- admin (x-admin-key) ----------------
  app.post("/admin/corporate-actions", async (c) => {
    requireAdmin(c);
    const b = await body(
      c,
      z.object({
        stockToken: address,
        kind: z.enum(["dividend", "split"]),
        exDate: z.string(),
        payDate: z.string().optional(),
        amountUsd: z.string().optional(),
        ratio: z
          .string()
          .regex(/^\d+:\d+$/)
          .optional(),
        note: z.string().max(500).optional(),
      }),
    );
    if (b.kind === "split" && !b.ratio) throw new HttpError(400, "split needs ratio like 2:1");
    const [num, den] = b.ratio ? b.ratio.split(":").map(Number) : [null, null];
    const [row] = await deps.db
      .insert(appTables.corporateActions)
      .values({
        stockToken: b.stockToken,
        kind: b.kind,
        exDate: new Date(toUnix(b.exDate)! * 1000),
        payDate: b.payDate ? new Date(toUnix(b.payDate)! * 1000) : null,
        amountUsd: b.amountUsd ?? null,
        ratioNum: num ?? null,
        ratioDen: den ?? null,
        note: b.note ?? null,
      })
      .returning();
    return c.json(row, 201);
  });
  app.delete("/admin/comments/:id", async (c) => {
    requireAdmin(c);
    return c.json(await hideComment(deps, Number(c.req.param("id")), c.req.query("reason")));
  });
  app.post("/admin/bans", async (c) => {
    requireAdmin(c);
    const b = await body(c, z.object({ address, reason: z.string().optional() }));
    return c.json(await banWallet(deps, b.address as Address, b.reason));
  });

  return app;
}
