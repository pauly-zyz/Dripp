import { and, asc, desc, eq, gte, notInArray, sql } from "drizzle-orm";
import type { Address } from "viem";
import {
  DAY,
  ONE,
  SECONDS_PER_YEAR,
  ZERO_ADDRESS,
  dividendFraction,
  impliedDividendApy,
  impliedFixedApy,
  realizedDividendApy,
  riskScore,
  toSharePrice,
  tokenPriceInStock,
  type RiskScore,
} from "@dripp/shared";
import { cached } from "../cache.ts";
import { ponder } from "../db.ts";
import { HttpError, isoDate, str, wadToNumber } from "../util.ts";
import type { Deps } from "./context.ts";

type SeriesRow = typeof ponder.series.$inferSelect;
type StockRow = typeof ponder.stockToken.$inferSelect;
type PoolRow = typeof ponder.pool.$inferSelect;

export interface Price {
  /** Raw stock tokens per PT/YT. */
  stock: number | null;
  /** In series shares (1 PT + 1 YT = 1 share). */
  shares: number | null;
  usd: number | null;
}

export interface PoolSnapshot {
  address: Address;
  side: "PT" | "YT";
  fee: number;
  tokenReserve: string;
  stockReserve: string;
  liquidityShares: number;
}

export interface MarketSnapshot {
  series: string;
  vault: Address;
  stock: { address: Address; ticker: string | null };
  pt: Address;
  yt: Address;
  maturity: number;
  maturityDate: string;
  secondsToMaturity: number;
  status: "active" | "matured";
  paused: boolean;
  /** Vault index: series shares per raw stock token (18 decimals). */
  index: string;
  /** Stock (UI) shares one PT redeems for: grows with stock splits. */
  stockSharesPerPT: number;
  /** USD per series share from the stock's Chainlink feed (null without a feed). */
  sharePriceUsd: number | null;
  ptPrice: Price;
  ytPrice: Price;
  /** "Imbal hasil tetap tersirat": annualized yield of buying PT now and holding to maturity. */
  impliedFixedApy: number | null;
  /** "Dividen tersirat": annualized dividend yield implied by the YT price. */
  impliedDividendApy: number | null;
  /** Trailing (up to 1 year) dividend yield confirmed by the oracle. */
  realizedDividendApy: number | null;
  tvl: { reserves: string; shares: number; usd: number | null };
  supply: { pt: string; yt: string };
  depositCap: string | null;
  volume24hShares: number;
  pools: PoolSnapshot[];
  risk: RiskScore;
}

export interface MarketFilter {
  stock?: string;
  maturity?: string;
  status?: "active" | "matured";
}

const cacheTtl = (deps: Deps) => Math.max(2, Math.floor(deps.config.pricePollMs / 1000));
const UNCAPPED = (1n << 256n) - 1n;

/** Chain time (handles test chains whose clock jumps) with a 5s cache. */
export function chainNow(deps: Deps) {
  return cached(deps.cache, "chain:now", 5, () => deps.chain.blockTimestamp());
}

export async function getMarkets(deps: Deps, filter: MarketFilter = {}): Promise<MarketSnapshot[]> {
  const all = await cached(deps.cache, "markets:v1", cacheTtl(deps), () => computeMarkets(deps));
  const stock = filter.stock?.toLowerCase();
  const maturity = filter.maturity?.toUpperCase();
  return all.filter(
    (m) =>
      (!stock || m.stock.address === stock || m.stock.ticker?.toLowerCase() === stock) &&
      (!maturity || m.series.endsWith(`-${maturity}`) || String(m.maturity) === maturity) &&
      (!filter.status || m.status === filter.status),
  );
}

/** Finds a series by name ("AAPL-MAR27") or vault address. */
export async function getMarket(deps: Deps, id: string): Promise<MarketSnapshot> {
  const all = await getMarkets(deps);
  const key = id.toLowerCase();
  const m = all.find((x) => x.vault === key || x.series.toLowerCase() === key);
  if (!m) throw new HttpError(404, `unknown series ${id}`);
  return m;
}

async function computeMarkets(deps: Deps): Promise<MarketSnapshot[]> {
  const { db } = deps;
  const [rows, stocks, pools, now] = await Promise.all([
    db.select().from(ponder.series).orderBy(asc(ponder.series.maturity)),
    db.select().from(ponder.stockToken),
    db.select().from(ponder.pool),
    chainNow(deps),
  ]);
  const stockBy = new Map(stocks.map((s) => [s.address, s]));
  return Promise.all(
    rows.map((s) =>
      buildSnapshot(
        deps,
        s,
        stockBy.get(s.stockToken),
        pools.filter((p) => p.vault === s.vault),
        now,
      ),
    ),
  );
}

async function buildSnapshot(
  deps: Deps,
  s: SeriesRow,
  stock: StockRow | undefined,
  pools: PoolRow[],
  now: number,
): Promise<MarketSnapshot> {
  const { chain, config } = deps;
  const feed = config.deployment.stockTokens.find((t) => t.address === s.stockToken)?.feed ?? ZERO_ADDRESS;
  const [index, uiMultiplier, feedUsd] = await Promise.all([
    chain.currentIndex(s.vault),
    chain.uiMultiplier(s.stockToken),
    chain.feedPriceUsd(feed),
  ]);
  const stockSharesPerPT = Number((uiMultiplier * ONE) / index) / 1e18;
  // USD per series share = USD per stock share * stock shares per series share
  const shareUsd = feedUsd === null ? null : feedUsd * stockSharesPerPT;
  const idx = wadToNumber(index);

  const poolSnaps = await Promise.all(
    pools.map(async (p) => {
      const [{ sqrtPriceX96 }, tokenReserve, stockReserve] = await Promise.all([
        chain.slot0(p.address),
        chain.balanceOf(p.token, p.address),
        chain.balanceOf(p.stockToken, p.address),
      ]);
      const priceInStock = sqrtPriceX96 === 0n ? null : tokenPriceInStock(sqrtPriceX96, p.token, p.stockToken);
      const priceShares = priceInStock === null ? null : toSharePrice(priceInStock, index);
      const liquidityShares = wadToNumber(tokenReserve) * (priceShares ?? 0) + wadToNumber(stockReserve) * idx;
      return { p, priceInStock, priceShares, tokenReserve, stockReserve, liquidityShares };
    }),
  );
  // If a side has several pools (fee tiers), quote from the deepest one.
  const best = (side: "PT" | "YT") =>
    poolSnaps.filter((x) => x.p.side === side).sort((a, b) => b.liquidityShares - a.liquidityShares)[0];
  const price = (side: "PT" | "YT"): Price => {
    const b = best(side);
    const shares = b?.priceShares ?? null;
    return { stock: b?.priceInStock ?? null, shares, usd: shares === null || shareUsd === null ? null : shares * shareUsd };
  };
  const ptPrice = price("PT");
  const ytPrice = price("YT");

  const maturity = Number(s.maturity);
  const secondsToMaturity = Math.max(0, maturity - now);
  const matured = now >= maturity;
  const tvlShares = wadToNumber(s.reserves) * idx;

  const [realized, volume24hShares, risk] = await Promise.all([
    stock ? realizedApy(deps, stock, now) : Promise.resolve(null),
    volume24h(deps, s.vault, now),
    seriesRisk(deps, s, stock, poolSnaps.map((x) => x.p.address), {
      poolLiquidityShares: poolSnaps.reduce((a, x) => a + x.liquidityShares, 0),
      tvlShares,
      secondsToMaturity,
      now,
    }),
  ]);

  return {
    series: s.name,
    vault: s.vault,
    stock: { address: s.stockToken, ticker: stock?.ticker ?? null },
    pt: s.pt,
    yt: s.yt,
    maturity,
    maturityDate: isoDate(maturity),
    secondsToMaturity,
    status: matured ? "matured" : "active",
    paused: s.paused,
    index: index.toString(),
    stockSharesPerPT,
    sharePriceUsd: shareUsd,
    ptPrice,
    ytPrice,
    impliedFixedApy: matured || ptPrice.shares === null ? null : impliedFixedApy(ptPrice.shares, secondsToMaturity),
    impliedDividendApy:
      matured || ytPrice.shares === null ? null : impliedDividendApy(ytPrice.shares, secondsToMaturity),
    realizedDividendApy: realized,
    tvl: { reserves: s.reserves.toString(), shares: tvlShares, usd: shareUsd === null ? null : tvlShares * shareUsd },
    supply: { pt: s.ptSupply.toString(), yt: s.ytSupply.toString() },
    depositCap: s.depositCap === UNCAPPED ? null : s.depositCap.toString(),
    volume24hShares,
    pools: poolSnaps.map((x) => ({
      address: x.p.address,
      side: x.p.side as "PT" | "YT",
      fee: x.p.fee,
      tokenReserve: x.tokenReserve.toString(),
      stockReserve: x.stockReserve.toString(),
      liquidityShares: x.liquidityShares,
    })),
    risk,
  };
}

/** Trailing dividend yield from the oracle's confirmed proposals (window: last year or since registration). */
async function realizedApy(deps: Deps, stock: StockRow, now: number): Promise<number | null> {
  const { proposal } = ponder;
  const confirmed = await deps.db
    .select()
    .from(proposal)
    .where(and(eq(proposal.stockToken, stock.address), eq(proposal.status, "confirmed")))
    .orderBy(asc(proposal.resolvedAt));
  const windowStart = now - SECONDS_PER_YEAR;
  const start = Math.max(windowStart, Number(stock.registeredAt ?? windowStart));
  const before = confirmed.filter((p) => Number(p.resolvedAt) <= start);
  const indexThen = before.length
    ? before[before.length - 1]!.dividendIndexAfter
    : (confirmed[0]?.dividendIndexBefore ?? stock.dividendIndex);
  // Annualizing a few weeks of history overstates the yield: require 90 days.
  return realizedDividendApy(indexThen, stock.dividendIndex, now - start, 90 * DAY);
}

async function volume24h(deps: Deps, vault: Address, now: number): Promise<number> {
  const { swap } = ponder;
  const [row] = await deps.db
    .select({ v: sql<string>`coalesce(sum(abs(${swap.stockDelta}) * ${swap.index}), 0)` })
    .from(swap)
    .where(and(eq(swap.vault, vault), gte(swap.timestamp, BigInt(now - DAY))));
  return Number(row?.v ?? 0) / 1e36;
}

async function seriesRisk(
  deps: Deps,
  s: SeriesRow,
  stock: StockRow | undefined,
  poolAddresses: Address[],
  x: { poolLiquidityShares: number; tvlShares: number; secondsToMaturity: number; now: number },
): Promise<RiskScore> {
  const { db } = deps;
  const { proposal, holder } = ponder;
  const excluded = [...poolAddresses, s.vault];
  const concentration = async (token: Address) => {
    const where = and(eq(holder.token, token), notInArray(holder.account, excluded));
    const [top, [total]] = await Promise.all([
      db.select({ b: holder.balance }).from(holder).where(where).orderBy(desc(holder.balance)).limit(5),
      db.select({ t: sql<string>`coalesce(sum(${holder.balance}), 0)` }).from(holder).where(where),
    ]);
    const circulating = Number(total?.t ?? 0);
    return circulating > 0 ? top.reduce((a, r) => a + Number(r.b), 0) / circulating : 0;
  };
  const [ptTop, ytTop, [disputes]] = await Promise.all([
    concentration(s.pt),
    concentration(s.yt),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(proposal)
      .where(
        and(
          eq(proposal.stockToken, s.stockToken),
          eq(proposal.status, "disputed"),
          gte(proposal.resolvedAt, BigInt(x.now - 30 * DAY)),
        ),
      ),
  ]);
  return riskScore({
    poolLiquidityShares: x.poolLiquidityShares,
    tvlShares: x.tvlShares,
    secondsToMaturity: x.secondsToMaturity,
    pendingProposal: stock?.pendingProposalId != null,
    recentDisputes: disputes?.n ?? 0,
    top5HolderShare: Math.max(ptTop, ytTop),
  });
}

/** Detail page data: snapshot plus dividend history, swaps, price history and upcoming calendar. */
export async function getMarketDetail(deps: Deps, id: string) {
  const m = await getMarket(deps, id);
  const { db } = deps;
  const { proposal, swap } = ponder;
  const [proposals, swaps] = await Promise.all([
    db.select().from(proposal).where(eq(proposal.stockToken, m.stock.address)).orderBy(desc(proposal.proposedAt)),
    db.select().from(swap).where(eq(swap.vault, m.vault)).orderBy(desc(swap.timestamp), desc(swap.id)).limit(500),
  ]);
  const swapView = (w: (typeof swaps)[number]) => {
    const priceShares = toSharePrice(
      tokenPriceInStock(w.sqrtPriceX96, w.side === "PT" ? m.pt : m.yt, m.stock.address),
      w.index,
    );
    return {
      time: isoDate(w.timestamp),
      timestamp: Number(w.timestamp),
      side: w.side,
      type: w.tokenDelta < 0n ? "buy" : "sell",
      trader: w.trader,
      amount: (w.tokenDelta < 0n ? -w.tokenDelta : w.tokenDelta).toString(),
      stockAmount: (w.stockDelta < 0n ? -w.stockDelta : w.stockDelta).toString(),
      priceShares,
      txHash: w.txHash,
    };
  };
  const views = swaps.map(swapView);
  return {
    ...m,
    dividendHistory: proposals.map(proposalView),
    recentSwaps: views.slice(0, 50),
    priceHistory: {
      PT: views.filter((v) => v.side === "PT").reverse().map((v) => ({ t: v.timestamp, price: v.priceShares })),
      YT: views.filter((v) => v.side === "YT").reverse().map((v) => ({ t: v.timestamp, price: v.priceShares })),
    },
  };
}

export function proposalView(p: typeof ponder.proposal.$inferSelect) {
  return {
    id: p.id,
    stockToken: p.stockToken,
    proposalId: Number(p.proposalId),
    kind: p.kind,
    status: p.status,
    dividendPct: dividendFraction(p.dividendIndexBefore, p.dividendIndexAfter) * 100,
    splitRatio: wadToNumber(p.splitRatio),
    fromMultiplier: str(p.fromMultiplier),
    toMultiplier: str(p.toMultiplier),
    proposedAt: isoDate(p.proposedAt),
    disputeEndsAt: isoDate(p.disputeEndsAt),
    resolvedAt: p.resolvedAt === null ? null : isoDate(p.resolvedAt),
    proposer: p.proposer,
    disputer: p.disputer,
    txHash: p.txHash,
  };
}

