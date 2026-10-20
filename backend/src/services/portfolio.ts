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

const ONE = 10n ** 18n;
/** raw stock amount at an index (18 decimals) -> series shares as a float */
const toShares = (raw: bigint, index: bigint) => Number((raw * index) / ONE) / 1e18;

export interface SeriesPnl {
  series: string;
  vault: Address;
  /** Shares paid in: stock deposited by split + stock paid for PT/YT bought in pools. */
  costShares: number;
  /** Shares taken out: merge, redeem, YT dividends claimed, PT/YT sold in pools. */
  proceedsShares: number;
  /** Current value of PT/YT still held plus unclaimed YT dividends (net of fee). */
  valueShares: number;
  pnlShares: number;
  pnlPct: number | null;
  pnlUsd: number | null;
}

/**
 * Cash-flow PnL per series, in shares: value now (incl. unclaimed dividends) + proceeds − cost. Each flow is valued at the vault
 * index of its own event. PT/YT received by plain transfer count with zero cost.
 */
export async function computePnl(deps: Deps, account: Address, markets: MarketSnapshot[], valueByVault: Map<string, number>) {
  const { vaultAction, swap } = ponder;
  const [actions, swaps] = await Promise.all([
    deps.db.select().from(vaultAction).where(or(eq(vaultAction.caller, account), eq(vaultAction.receiver, account))),
    deps.db.select().from(swap).where(eq(swap.trader, account)),
  ]);
  const byVault = new Map<string, MarketSnapshot>(markets.map((m) => [m.vault, m]));
  const acc = new Map<string, { cost: number; proceeds: number }>();
  const get = (v: string) => acc.get(v) ?? (acc.set(v, { cost: 0, proceeds: 0 }), acc.get(v)!);
  for (const a of actions) {
    const m = byVault.get(a.vault);
    if (!m) continue;
    const index = a.index ?? BigInt(m.index);
    const e = get(a.vault);
    if (a.kind === "split" && a.caller === account) e.cost += toShares(a.stockAmount, index);
    else if (a.kind !== "split" && a.receiver === account) e.proceeds += toShares(a.stockAmount, index);
  }
  for (const w of swaps) {
    const e = get(w.vault);
    // pool deltas: user buys PT/YT -> pool receives stock (stockDelta > 0); sells -> pool pays stock
    if (w.tokenDelta < 0n) e.cost += toShares(w.stockDelta, w.index);
    else e.proceeds += toShares(-w.stockDelta, w.index);
  }
  for (const v of valueByVault.keys()) get(v);

  const bySeries: SeriesPnl[] = [...acc.entries()]
    .filter(([v]) => byVault.has(v))
    .map(([vault, e]) => {
      const m = byVault.get(vault)!;
      const valueShares = valueByVault.get(vault) ?? 0;
      const pnlShares = valueShares + e.proceeds - e.cost;
      return {
        series: m.series,
        vault: m.vault,
        costShares: e.cost,
        proceedsShares: e.proceeds,
        valueShares,
        pnlShares,
        pnlPct: e.cost > 0 ? pnlShares / e.cost : null,
        pnlUsd: m.sharePriceUsd === null ? null : pnlShares * m.sharePriceUsd,
      };
    });
  return bySeries;
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

  const valueByVault = new Map<string, number>();
  for (const p of positions) valueByVault.set(p.vault, (valueByVault.get(p.vault) ?? 0) + (p.valueShares ?? 0));
  // unclaimed YT dividends are part of what the position is worth
  for (const c of claimable.items) valueByVault.set(c.vault, (valueByVault.get(c.vault) ?? 0) + c.netShares);
  const pnl = await computePnl(deps, account, markets, valueByVault);
  const allPriced = positions.every((p) => p.valueUsd !== null);
  return {
    account,
    positions,
    claimable: claimable.items,
    /** Cash-flow PnL per series in shares (see computePnl). */
    pnl,
    totals: {
      valueUsd: allPriced ? positions.reduce((a, p) => a + (p.valueUsd ?? 0), 0) : null,
      claimableUsd: claimable.totalNetUsd,
    },
    /** PT positions past maturity that are not redeemed yet (maturity reminders). */
    maturityReminders: positions.filter((p) => p.kind === "PT").map((p) => ({ series: p.series, maturity: p.maturity, matured: p.matured })),
    activity,
  };
}

