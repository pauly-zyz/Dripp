import { eq } from "drizzle-orm";
import { ponder } from "../db.ts";
import { str } from "../util.ts";
import type { Deps } from "./context.ts";
import { getMarkets } from "./markets.ts";

/** Contract addresses, roles, fees and per-vault reserves (Transparency page / web app wiring). */
export async function getProtocol(deps: Deps) {
  const d = deps.config.deployment;
  const [[proto], stocks, markets] = await Promise.all([
    deps.db.select().from(ponder.protocol).where(eq(ponder.protocol.id, "factory")),
    deps.db.select().from(ponder.stockToken),
    getMarkets(deps),
  ]);
  return {
    chainId: d.chainId,
    contracts: { factory: d.factory, oracle: d.oracle, router: d.router, owner: d.owner },
    uniswap: d.uniswap,
    roles: { owner: d.owner, guardian: proto?.guardian ?? null, treasury: proto?.treasury ?? null, stockDrip: proto?.stockDrip ?? null },
    fees: {
      ytFeeBps: proto?.ytFeeBps ?? null,
      zapFeeBps: proto?.zapFeeBps ?? null,
      stockDripShareBps: proto?.stockDripShareBps ?? null,
    },
    disputeWindowSeconds: 86_400,
    stockTokens: stocks.map((s) => ({
      address: s.address,
      ticker: s.ticker,
      allowed: s.allowed,
      confirmedMultiplier: str(s.confirmedMultiplier),
      dividendIndex: str(s.dividendIndex),
      splitFactor: str(s.splitFactor),
      pendingProposalId: str(s.pendingProposalId),
    })),
    /** Proof of reserves: raw stock held by each vault vs. PT outstanding (both in series shares). */
    reserves: markets.map((m) => {
      const ptShares = Number(m.supply.pt) / 1e18;
      return {
        series: m.series,
        vault: m.vault,
        pt: m.pt,
        yt: m.yt,
        stockToken: m.stock.address,
        reservesRaw: m.tvl.reserves,
        reservesShares: m.tvl.shares,
        ptSupply: m.supply.pt,
        ytSupply: m.supply.yt,
        /** Shares held per PT share owed; >= 1 means fully backed (the rest is YT yield + rounding). */
        backingRatio: ptShares > 0 ? m.tvl.shares / ptShares : null,
        paused: m.paused,
      };
    }),
  };
}
