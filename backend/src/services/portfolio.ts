import { and, desc, eq, or } from "drizzle-orm";
import type { Address } from "viem";
import { ponder } from "../db.ts";
import { isoDate, wadToNumber } from "../util.ts";
import type { Deps } from "./context.ts";
import { getMarkets, type MarketSnapshot } from "./markets.ts";

async function ytFeeBps(deps: Deps) {
  const [row] = await deps.db.select().from(ponder.protocol).where(eq(ponder.protocol.id, "factory"));
  return row?.ytFeeBps ?? 500;
}

/** YT yield claimable by `account` in every series it ever held YT in (balance 0 included). */
export async function getClaimable(deps: Deps, account: Address) {
  const { holder } = ponder;
  const [rows, markets, feeBps] = await Promise.all([
    deps.db.select().from(holder).where(and(eq(holder.account, account), eq(holder.kind, "YT"))),
    getMarkets(deps),
    ytFeeBps(deps),
  ]);
  const byVault = new Map(markets.map((m) => [m.vault, m]));
  const items = (
    await Promise.all(
      rows.map(async (h) => {
        const m = byVault.get(h.vault);
        if (!m) return null;
        const gross = await deps.chain.claimableYield(h.vault, account);
        if (gross === 0n) return null;
        const fee = (gross * BigInt(feeBps)) / 10_000n;
        const net = gross - fee;
        const netShares = (wadToNumber(net) * Number(m.index)) / 1e18;
        const shareUsd = m.sharePriceUsd;
        return {
          series: m.series,
          vault: m.vault,
          stockToken: m.stock.address,
          ticker: m.stock.ticker,
          /** Raw stock tokens. */
          gross: gross.toString(),
          fee: fee.toString(),
          net: net.toString(),
          netShares,
          netUsd: shareUsd === null ? null : netShares * shareUsd,
        };
      }),
    )
  ).filter((x): x is NonNullable<typeof x> => x !== null);
  const usd = items.every((i) => i.netUsd !== null) ? items.reduce((a, i) => a + (i.netUsd ?? 0), 0) : null;
  return { account, feeBps, items, totalNetUsd: items.length ? usd : 0 };
}

export async function getPortfolio(deps: Deps, account: Address) {
  const { db } = deps;
  const { holder, vaultAction, zap, swap } = ponder;
  const [holdings, markets, claimable, actions, zaps, swaps] = await Promise.all([
    db.select().from(holder).where(eq(holder.account, account)),
    getMarkets(deps),
    getClaimable(deps, account),
    db
      .select()
      .from(vaultAction)
      .where(or(eq(vaultAction.caller, account), eq(vaultAction.receiver, account)))
      .orderBy(desc(vaultAction.timestamp))
      .limit(50),
    db.select().from(zap).where(eq(zap.sender, account)).orderBy(desc(zap.timestamp)).limit(50),
    db.select().from(swap).where(eq(swap.trader, account)).orderBy(desc(swap.timestamp)).limit(50),
  ]);
  const byVault = new Map<string, MarketSnapshot>(markets.map((m) => [m.vault, m]));

  const positions = holdings
    .filter((h) => h.balance > 0n)
    .map((h) => {
      const m = byVault.get(h.vault);
      const price = h.kind === "PT" ? m?.ptPrice : m?.ytPrice;
      const amount = wadToNumber(h.balance);
      const valueShares = price?.shares == null ? null : amount * price.shares;
      return {
        series: m?.series ?? null,
        vault: h.vault,
        kind: h.kind,
        token: h.token,
        ticker: m?.stock.ticker ?? null,
        balance: h.balance.toString(),
        price: price ?? null,
        valueShares,
        valueUsd: valueShares === null || price?.usd == null || !price.shares ? null : amount * price.usd,
        maturity: m ? m.maturityDate : null,
        matured: m?.status === "matured",
        /** PT can be redeemed for the stock (matured), or merged with the same amount of YT any time. */
        redeemable: h.kind === "PT" && m?.status === "matured",
      };
    });

  const activity = [
    ...actions.map((a) => ({
      type: a.kind,
      vault: a.vault,
      timestamp: Number(a.timestamp),
      time: isoDate(a.timestamp),
      stockAmount: a.stockAmount.toString(),
      pyAmount: a.pyAmount.toString(),
      fee: a.fee.toString(),
      txHash: a.txHash,
    })),
    ...zaps.map((z) => ({
      type: `zap:${z.target}`,
      vault: z.vault,
      timestamp: Number(z.timestamp),
      time: isoDate(z.timestamp),
      tokenIn: z.tokenIn,
      amountIn: z.amountIn.toString(),
      amountOut: z.amountOut.toString(),
      fee: z.fee.toString(),
      txHash: z.txHash,
    })),
    ...swaps.map((w) => ({
      type: `${w.tokenDelta < 0n ? "buy" : "sell"}:${w.side}`,
      vault: w.vault,
      timestamp: Number(w.timestamp),
      time: isoDate(w.timestamp),
      amount: (w.tokenDelta < 0n ? -w.tokenDelta : w.tokenDelta).toString(),
      stockAmount: (w.stockDelta < 0n ? -w.stockDelta : w.stockDelta).toString(),
      txHash: w.txHash,
    })),
  ]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 50);

  const allPriced = positions.every((p) => p.valueUsd !== null);
  return {
    account,
    positions,
    claimable: claimable.items,
    totals: {
      valueUsd: allPriced ? positions.reduce((a, p) => a + (p.valueUsd ?? 0), 0) : null,
      claimableUsd: claimable.totalNetUsd,
    },
    /** PT positions past maturity that are not redeemed yet (maturity reminders). */
    maturityReminders: positions.filter((p) => p.kind === "PT").map((p) => ({ series: p.series, maturity: p.maturity, matured: p.matured })),
    activity,
  };
}

