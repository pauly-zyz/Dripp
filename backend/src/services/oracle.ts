import { and, desc, eq, type SQL } from "drizzle-orm";
import { ponder } from "../db.ts";
import { HttpError } from "../util.ts";
import type { Deps } from "./context.ts";
import { chainNow, proposalView } from "./markets.ts";

const STATUSES = ["pending", "confirmed", "disputed"] as const;

/** DividendOracle proposals, newest first. `confirmable` = dispute window over, waiting for confirm(). */
export async function getProposals(deps: Deps, q: { status?: string; stock?: string; limit?: number }) {
  const { proposal, stockToken } = ponder;
  const where: SQL[] = [];
  if (q.status) {
    if (!(STATUSES as readonly string[]).includes(q.status)) throw new HttpError(400, "invalid status");
    where.push(eq(proposal.status, q.status));
  }
  const [rows, stocks, now] = await Promise.all([
    deps.db
      .select()
      .from(proposal)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(proposal.proposedAt))
      .limit(Math.min(q.limit ?? 100, 500)),
    deps.db.select().from(stockToken),
    chainNow(deps),
  ]);
  const ticker = new Map(stocks.map((s) => [s.address, s.ticker]));
  const wanted = q.stock?.toLowerCase();
  return rows
    .filter((p) => !wanted || p.stockToken === wanted || ticker.get(p.stockToken)?.toLowerCase() === wanted)
    .map((p) => ({
      ...proposalView(p),
      ticker: ticker.get(p.stockToken) ?? null,
      secondsLeftInDisputeWindow: p.status === "pending" ? Math.max(0, Number(p.disputeEndsAt) - now) : 0,
      confirmable: p.status === "pending" && now >= Number(p.disputeEndsAt),
    }));
}
