/**
 * Demo mode: an in-browser stand-in for the Dripp API, used for previews (e.g. Vercel) while the
 * contracts, indexer and backend are not deployed. Prices, implied yields and risk scores are derived
 * with the same @dripp/shared math as the backend; the series and stock tokens follow
 * contracts/config/robinhood-mainnet.json. Vault/PT/YT/oracle addresses and tx hashes are placeholders.
 */
import { DAY, impliedDividendApy, impliedFixedApy, riskScore, SECONDS_PER_YEAR } from "@dripp/shared/browser";
import type { Address, Hex } from "viem";
import {
  ApiError,
  DEMO_ACCOUNT,
  type BuyQuote,
  type CalendarEntry,
  type Claimable,
  type Comment,
  type Market,
  type MarketDetail,
  type Portfolio,
  type Proposal,
  type Protocol,
  type SellQuote,
  type SwapView,
} from "./api";

// ---------------- deterministic randomness ----------------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hex = (r: () => number, bytes: number) =>
  ("0x" + Array.from({ length: bytes * 2 }, () => Math.floor(r() * 16).toString(16)).join("")) as Hex;
const R = rng(4663);
const fakeAddr = () => hex(R, 20) as Address;
const fakeTx = () => hex(R, 32);

const WAD = 10n ** 18n;
const toWad = (x: number) => BigInt(Math.round(x * 1e6)) * 10n ** 12n;
const NOW = Math.floor(Date.now() / 1000);
const iso = (t: number) => new Date(t * 1000).toISOString();

// ---------------- protocol ----------------

const UNISWAP = {
  v3Factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  swapRouter: "0xCaf681a66D020601342297493863E78C959E5cb2",
  legacyRouter: false,
  quoterV2: "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7",
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
} as const satisfies Protocol["uniswap"];

const CONTRACTS = { factory: fakeAddr(), oracle: fakeAddr(), router: fakeAddr(), owner: fakeAddr() };
const ROLES = { owner: CONTRACTS.owner, guardian: fakeAddr(), treasury: fakeAddr(), stockDrip: null };
const KEEPER = fakeAddr();
const MULTISIG = fakeAddr();
const ETH_USD = 3920;

interface StockDef {
  ticker: string;
  address: Address;
  usd: number;
  /** Confirmed dividend index (dividends paid since listing). */
  dividendIndex: number;
  /** Quarterly cash dividend in USD (0 = none). */
  quarterlyDividend: number;
}

const STOCKS: StockDef[] = [
  { ticker: "AAPL", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", usd: 252.4, dividendIndex: 1.00412, quarterlyDividend: 0.26 },
  { ticker: "NVDA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", usd: 186.2, dividendIndex: 1.00011, quarterlyDividend: 0.01 },
  { ticker: "TSLA", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", usd: 441.7, dividendIndex: 1, quarterlyDividend: 0 },
];
const stockBy = (t: string) => STOCKS.find((s) => s.ticker === t)!;

interface SeriesDef {
  ticker: string;
  maturity: number;
  /** Market's fixed yield (PT) and expected dividend yield (YT), annualized. */
  fixedApy: number;
  dividendApy: number;
  tvlShares: number;
  poolPtShares: number;
  poolYtShares: number;
  top5: number;
  volume24h: number;
  depositCap: number;
}

const SERIES: SeriesDef[] = [
  { ticker: "AAPL", maturity: 1806019200, fixedApy: 0.0047, dividendApy: 0.0041, tvlShares: 1840, poolPtShares: 760, poolYtShares: 210, top5: 0.31, volume24h: 64.2, depositCap: 5000 },
  { ticker: "AAPL", maturity: 1821916800, fixedApy: 0.0052, dividendApy: 0.0044, tvlShares: 920, poolPtShares: 330, poolYtShares: 70, top5: 0.42, volume24h: 18.7, depositCap: 5000 },
  { ticker: "NVDA", maturity: 1806019200, fixedApy: 0.0009, dividendApy: 0.0004, tvlShares: 2310, poolPtShares: 1020, poolYtShares: 260, top5: 0.27, volume24h: 112.5, depositCap: 5000 },
  { ticker: "TSLA", maturity: 1806019200, fixedApy: 0.0011, dividendApy: 0.0002, tvlShares: 610, poolPtShares: 150, poolYtShares: 30, top5: 0.58, volume24h: 9.4, depositCap: 2500 },
];

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const seriesName = (s: SeriesDef) => {
  const d = new Date(s.maturity * 1000);
  return `${s.ticker}-${MONTHS[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(2)}`;
};

// ---------------- oracle history ----------------

interface ProposalSeed {
  ticker: string;
  daysAgo: number;
  dividendPct: number;
  status: Proposal["status"];
}

const PROPOSALS: ProposalSeed[] = [
  { ticker: "AAPL", daysAgo: 251, dividendPct: 0.1034, status: "confirmed" },
  { ticker: "AAPL", daysAgo: 160, dividendPct: 0.1089, status: "confirmed" },
  { ticker: "AAPL", daysAgo: 69, dividendPct: 0.1031, status: "confirmed" },
  { ticker: "NVDA", daysAgo: 118, dividendPct: 0.0054, status: "confirmed" },
  { ticker: "NVDA", daysAgo: 27, dividendPct: 0.0537, status: "disputed" },
  { ticker: "NVDA", daysAgo: 26, dividendPct: 0.0054, status: "confirmed" },
  { ticker: "AAPL", daysAgo: 0.27, dividendPct: 0.1024, status: "pending" },
];

const proposals: Proposal[] = (() => {
  const counters: Record<string, number> = {};
  const multipliers: Record<string, number> = { AAPL: 1, NVDA: 1, TSLA: 1 };
  const proposer = KEEPER;
  return PROPOSALS.map((p) => {
    const stock = stockBy(p.ticker);
    const id = (counters[p.ticker] = (counters[p.ticker] ?? 0) + 1);
    const from = multipliers[p.ticker]!;
    const to = from * (1 + p.dividendPct / 100);
    if (p.status === "confirmed") multipliers[p.ticker] = to;
    const proposedAt = NOW - Math.round(p.daysAgo * DAY);
    const disputeEndsAt = proposedAt + DAY;
    const resolvedAt = p.status === "pending" ? null : p.status === "disputed" ? proposedAt + 3 * 3600 : disputeEndsAt + 600;
    return {
      id: `${stock.address.toLowerCase()}-${id}`,
      stockToken: stock.address,
      proposalId: id,
      kind: "dividend" as const,
      status: p.status,
      dividendPct: p.dividendPct,
      splitRatio: 1,
      fromMultiplier: toWad(from).toString(),
      toMultiplier: toWad(to).toString(),
      proposedAt: iso(proposedAt),
      disputeEndsAt: iso(disputeEndsAt),
      resolvedAt: resolvedAt === null ? null : iso(resolvedAt),
      proposer,
      disputer: p.status === "disputed" ? MULTISIG : null,
      txHash: fakeTx(),
      ticker: p.ticker,
      secondsLeftInDisputeWindow: Math.max(0, disputeEndsAt - NOW),
      confirmable: p.status === "pending" && disputeEndsAt <= NOW,
    };
  }).sort((a, b) => b.proposedAt.localeCompare(a.proposedAt));
})();

// ---------------- markets ----------------

const priceAt = (apy: number, secondsLeft: number) => Math.pow(1 + apy, -Math.max(0, secondsLeft) / SECONDS_PER_YEAR);

interface Built {
  def: SeriesDef;
  market: Market;
  detail: MarketDetail;
}

const built: Built[] = SERIES.map((def, i) => {
  const r = rng(100 + i);
  const stock = stockBy(def.ticker);
  const left = def.maturity - NOW;
  const ptShares = priceAt(def.fixedApy, left);
  const ytShares = 1 - priceAt(def.dividendApy, left);
  const index = toWad(stock.dividendIndex);
  // A series share is worth `1/index` stock tokens.
  const sharePriceUsd = stock.usd / stock.dividendIndex;
  const toStock = (shares: number) => shares / stock.dividendIndex;
  const price = (shares: number) => ({ stock: toStock(shares), shares, usd: shares * sharePriceUsd });
  const supply = toWad(def.tvlShares);
  const pending = proposals.some((p) => p.ticker === def.ticker && p.status === "pending");
  const disputes = proposals.filter((p) => p.ticker === def.ticker && p.status === "disputed" && NOW - Date.parse(p.proposedAt) / 1000 < 30 * DAY).length;
  const risk = riskScore({
    poolLiquidityShares: def.poolPtShares + def.poolYtShares,
    tvlShares: def.tvlShares,
    secondsToMaturity: left,
    pendingProposal: pending,
    recentDisputes: disputes,
    top5HolderShare: def.top5,
  });
  const name = seriesName(def);
  const vault = fakeAddr();
  const pt = fakeAddr();
  const yt = fakeAddr();

  const market: Market = {
    series: name,
    vault,
    stock: { address: stock.address, ticker: stock.ticker },
    pt,
    yt,
    maturity: def.maturity,
    maturityDate: iso(def.maturity),
    secondsToMaturity: left,
    status: left > 0 ? "active" : "matured",
    paused: false,
    index: index.toString(),
    stockSharesPerPT: 1 / stock.dividendIndex,
    sharePriceUsd,
    ptPrice: price(ptShares),
    ytPrice: price(ytShares),
    impliedFixedApy: impliedFixedApy(ptShares, left),
    impliedDividendApy: impliedDividendApy(ytShares, left),
    realizedDividendApy: stock.quarterlyDividend > 0 ? (stock.quarterlyDividend * 4) / stock.usd : null,
    tvl: { reserves: toWad(toStock(def.tvlShares)).toString(), shares: def.tvlShares, usd: def.tvlShares * sharePriceUsd },
    supply: { pt: supply.toString(), yt: supply.toString() },
    depositCap: toWad(def.depositCap).toString(),
    volume24hShares: def.volume24h,
    pools: [
      {
        address: fakeAddr(),
        side: "PT",
        fee: 3000,
        tokenReserve: toWad(def.poolPtShares / 2 / ptShares).toString(),
        stockReserve: toWad(toStock(def.poolPtShares / 2)).toString(),
        liquidityShares: def.poolPtShares,
      },
      {
        address: fakeAddr(),
        side: "YT",
        fee: 10000,
        tokenReserve: toWad(def.poolYtShares / 2 / ytShares).toString(),
        stockReserve: toWad(toStock(def.poolYtShares / 2)).toString(),
        liquidityShares: def.poolYtShares,
      },
    ],
    risk,
  };

  // 45 days of history: the yield wobbles around today's level and PT accretes to par.
  const PT: { t: number; price: number }[] = [];
  const YT: { t: number; price: number }[] = [];
  let fx = def.fixedApy * (1 + (r() - 0.5) * 0.5);
  let dx = def.dividendApy * (1 + (r() - 0.5) * 0.5);
  const steps = 90;
  for (let k = 0; k <= steps; k++) {
    const t = NOW - Math.round(((steps - k) / steps) * 45 * DAY);
    const w = k / steps;
    fx = fx * (1 - 0.15) + (def.fixedApy * (1 + (r() - 0.5) * 0.35)) * 0.15;
    dx = dx * (1 - 0.15) + (def.dividendApy * (1 + (r() - 0.5) * 0.35)) * 0.15;
    const f = k === steps ? def.fixedApy : fx * (1 - w * 0.2) + def.fixedApy * w * 0.2;
    const d = k === steps ? def.dividendApy : dx * (1 - w * 0.2) + def.dividendApy * w * 0.2;
    PT.push({ t, price: priceAt(f, def.maturity - t) });
    YT.push({ t, price: 1 - priceAt(d, def.maturity - t) });
  }

  const recentSwaps: SwapView[] = Array.from({ length: 14 }, (_, k) => {
    const side: "PT" | "YT" = r() < 0.65 ? "PT" : "YT";
    const px = side === "PT" ? ptShares : ytShares;
    const amount = side === "PT" ? 0.5 + r() * 24 : 5 + r() * 220;
    const t = NOW - Math.round(k * 2.7 * 3600 + r() * 3600);
    return {
      time: iso(t),
      timestamp: t,
      side,
      type: r() < 0.6 ? "buy" : "sell",
      trader: fakeAddr(),
      amount: toWad(amount).toString(),
      stockAmount: toWad(toStock(amount * px)).toString(),
      priceShares: px * (1 + (r() - 0.5) * 0.002),
      txHash: fakeTx(),
    };
  });

  const detail: MarketDetail = {
    ...market,
    dividendHistory: proposals.filter((p) => p.ticker === def.ticker),
    recentSwaps,
    priceHistory: { PT, YT },
  };
  return { def, market, detail };
});

const markets = built.map((b) => b.market);
const findSeries = (key: string) => {
  const k = decodeURIComponent(key).toLowerCase();
  const b = built.find((x) => x.market.series.toLowerCase() === k || x.market.vault.toLowerCase() === k);
  if (!b) throw new ApiError(404, `unknown series ${key}`);
  return b;
};

// ---------------- calendar ----------------

const calendar: CalendarEntry[] = (() => {
  const entries: CalendarEntry[] = proposals.map((p) => ({
    date: p.status === "confirmed" ? p.resolvedAt! : p.proposedAt,
    timestamp: Math.floor(Date.parse(p.status === "confirmed" ? p.resolvedAt! : p.proposedAt) / 1000),
    stockToken: p.stockToken,
    ticker: p.ticker ?? null,
    type: p.status === "pending" ? "proposed" : p.status,
    kind: p.kind,
    dividendPct: p.dividendPct,
    splitRatio: null,
    source: "oracle",
    txHash: p.txHash,
    note: p.status === "disputed" ? "Disanggah multisig: persentase tidak sesuai pengumuman emiten" : null,
  }));
  const upcoming = (ticker: string, days: number, type: CalendarEntry["type"], source: CalendarEntry["source"], note: string) => {
    const s = stockBy(ticker);
    const t = NOW + days * DAY;
    entries.push({
      date: iso(t),
      timestamp: t,
      stockToken: s.address,
      ticker,
      type,
      kind: "dividend",
      dividendPct: (s.quarterlyDividend / s.usd) * 100,
      splitRatio: null,
      source,
      txHash: null,
      note,
    });
  };
  upcoming("NVDA", 66, "announced", "team", "Perkiraan ex-dividen kuartalan");
  upcoming("AAPL", 91, "scheduled", "erc8056", "Perubahan uiMultiplier terjadwal on-chain");
  upcoming("NVDA", 157, "announced", "team", "Perkiraan ex-dividen kuartalan");
  return entries.sort((a, b) => a.timestamp - b.timestamp);
})();

// ---------------- portfolio ----------------

const portfolio = (account: string): Portfolio => {
  const [aaplMar, aaplSep, nvda] = built;
  const pos = (b: Built, kind: "PT" | "YT", balance: number) => {
    const p = kind === "PT" ? b.market.ptPrice : b.market.ytPrice;
    return {
      series: b.market.series,
      vault: b.market.vault,
      kind,
      token: kind === "PT" ? b.market.pt : b.market.yt,
      ticker: b.market.stock.ticker,
      balance: toWad(balance).toString(),
      price: p,
      valueShares: balance * p.shares!,
      valueUsd: balance * p.usd!,
      maturity: b.market.maturityDate,
      matured: false,
      redeemable: false,
    };
  };
  const positions = [pos(aaplMar!, "PT", 12.5), pos(aaplSep!, "YT", 340), pos(nvda!, "PT", 30), pos(nvda!, "YT", 120)];
  const claim = (b: Built, gross: number): Claimable => {
    const fee = gross * 0.05;
    return {
      series: b.market.series,
      vault: b.market.vault,
      stockToken: b.market.stock.address,
      ticker: b.market.stock.ticker,
      gross: toWad(gross).toString(),
      fee: toWad(fee).toString(),
      net: toWad(gross - fee).toString(),
      netShares: gross - fee,
      netUsd: (gross - fee) * b.market.sharePriceUsd!,
    };
  };
  const claimable = [claim(aaplSep!, 0.3482), claim(nvda!, 0.0065)];
  const value = (series: string) =>
    positions.filter((p) => p.series === series).reduce((a, p) => a + p.valueShares, 0) +
    claimable.filter((c) => c.series === series).reduce((a, c) => a + c.netShares, 0);
  const pnlRow = (b: Built, cost: number, proceeds: number) => {
    const v = value(b.market.series);
    const pnl = v + proceeds - cost;
    return {
      series: b.market.series,
      vault: b.market.vault,
      costShares: cost,
      proceedsShares: proceeds,
      valueShares: v,
      pnlShares: pnl,
      pnlPct: pnl / cost,
      pnlUsd: pnl * b.market.sharePriceUsd!,
    };
  };
  const pnl = [pnlRow(aaplMar!, 12.43, 0), pnlRow(aaplSep!, 1.21, 0.0918), pnlRow(nvda!, 30.02, 0.004)];
  const act = (type: string, b: Built, daysAgo: number, extra: Record<string, unknown>) => {
    const t = NOW - Math.round(daysAgo * DAY);
    return { type, vault: b.market.vault, timestamp: t, time: iso(t), txHash: fakeTx(), ...extra };
  };
  return {
    account: account.toLowerCase() as Address,
    positions,
    claimable,
    pnl,
    totals: {
      valueUsd: positions.reduce((a, p) => a + p.valueUsd, 0),
      claimableUsd: claimable.reduce((a, c) => a + (c.netUsd ?? 0), 0),
    },
    maturityReminders: [aaplMar!, aaplSep!, nvda!].map((b) => ({ series: b.market.series, maturity: b.market.maturityDate, matured: false })),
    activity: [
      act("claim", aaplSep!, 68, { stockAmount: toWad(0.0918).toString(), pyAmount: "0", fee: toWad(0.0048).toString() }),
      act("zap:YT", aaplSep!, 95, { amountIn: toWad(0.078).toString(), pyAmount: toWad(340).toString() }),
      act("zap:PT", aaplMar!, 101, { amountIn: toWad(0.8).toString(), pyAmount: toWad(12.5).toString() }),
      act("zap:YT", nvda!, 118, { amountIn: toWad(0.002).toString(), pyAmount: toWad(120).toString() }),
      act("split", nvda!, 122, { stockAmount: toWad(30).toString(), pyAmount: toWad(30).toString() }),
    ],
  };
};

// ---------------- comments & referrals ----------------

const COMMENT_BODIES = [
  "Beli PT di sini buat parkir dana sampai Maret, lumayan daripada diam.",
  "Implied dividend di YT masih di bawah realized tahun lalu. Ada yang tahu kenapa?",
  "Oracle sempat disanggah bulan lalu, tapi multisig cepat responsnya. Respek.",
  "Pool YT agak tipis, hati-hati slippage kalau beli besar.",
  "Split dulu lalu jual YT = dapat diskon saham. Strategi favorit.",
];
const comments: Record<string, Comment[]> = Object.fromEntries(
  built.map((b, i) => {
    const r = rng(900 + i);
    const n = 2 + Math.floor(r() * 3);
    return [
      b.market.series.toUpperCase(),
      Array.from({ length: n }, (_, k) => ({
        id: i * 10 + k + 1,
        author: fakeAddr(),
        body: COMMENT_BODIES[(i + k) % COMMENT_BODIES.length]!,
        createdAt: iso(NOW - Math.round((k + 1) * (5 + r() * 30) * 3600)),
      })),
    ];
  }),
);

const referrals = (address: string) => ({
  address: address.toLowerCase(),
  referralLink: `?ref=${address.toLowerCase()}`,
  referrer: null,
  referees:
    address.toLowerCase() === DEMO_ACCOUNT.toLowerCase()
      ? [
          { address: fakeAddr(), since: iso(NOW - 40 * DAY), points: 18.4 },
          { address: fakeAddr(), since: iso(NOW - 12 * DAY), points: 6.1 },
        ]
      : [],
  referralPoints: address.toLowerCase() === DEMO_ACCOUNT.toLowerCase() ? 2.45 : 0,
});

// ---------------- quotes ----------------

function quote(q: URLSearchParams): BuyQuote | SellQuote {
  const b = findSeries(q.get("series") ?? "");
  const side = q.get("side");
  const asset = (q.get("asset") ?? "PT") as "PT" | "YT" | "PY";
  const token = q.get("token") ?? "ETH";
  const amount = BigInt(q.get("amount") ?? "0");
  const slippageBps = Number(q.get("slippageBps") ?? 50);
  const m = b.market;
  const share = m.sharePriceUsd!;
  const unitShares = asset === "PT" ? m.ptPrice.shares! : asset === "YT" ? m.ytPrice.shares! : 1;
  const poolFee = asset === "YT" ? 0.01 : 0.003;
  const minOf = (x: bigint) => (x * BigInt(10_000 - slippageBps)) / 10_000n;
  const path = ("0x" + "00".repeat(43)) as Hex;
  if (side === "sell") {
    const shares = (Number(amount) / 1e18) * unitShares * (1 - poolFee);
    const out = token === "USDG" ? BigInt(Math.floor(shares * share * 1e6)) : toWad(shares / stockBy(m.stock.ticker!).dividendIndex);
    return {
      side: "sell",
      series: m.series,
      asset: asset === "PY" ? "PT" : asset,
      to: UNISWAP.swapRouter,
      method: "exactInput",
      legacyRouter: false,
      params: { path, amountIn: amount.toString(), minOut: minOf(out).toString() },
      value: "0",
      approve: { token: asset === "YT" ? m.yt : m.pt, spender: UNISWAP.swapRouter, amount: amount.toString() },
      route: [asset === "YT" ? m.yt : m.pt, m.stock.address],
      fee: "0",
      amountOut: out.toString(),
      minOut: minOf(out).toString(),
    };
  }
  const usdIn = token === "USDG" ? Number(amount) / 1e6 : token === "ETH" ? (Number(amount) / 1e18) * ETH_USD : (Number(amount) / 1e18) * stockBy(m.stock.ticker!).usd;
  const zapFee = 0.001;
  const sharesIn = (usdIn / share) * (1 - zapFee) * (token === "STOCK" ? 1 : 0.997);
  const out = toWad((sharesIn * (asset === "PY" ? 1 : 1 - poolFee)) / unitShares);
  const tokenIn = token === "ETH" ? ("0x0000000000000000000000000000000000000000" as Address) : token === "USDG" ? UNISWAP.usdg : m.stock.address;
  return {
    side: "buy",
    series: m.series,
    asset,
    to: CONTRACTS.router,
    method: "zap",
    params: { vault: m.vault, target: asset === "PT" ? 0 : asset === "YT" ? 1 : 2, tokenIn, amountIn: amount.toString(), path, minOut: minOf(out).toString() },
    value: token === "ETH" ? amount.toString() : "0",
    approve: token === "ETH" ? null : { token: tokenIn, spender: CONTRACTS.router, amount: amount.toString() },
    route: token === "ETH" ? [UNISWAP.weth, m.stock.address] : token === "USDG" ? [UNISWAP.usdg, m.stock.address] : [m.stock.address],
    fee: ((amount * 10n) / 10_000n).toString(),
    amountOut: out.toString(),
    minOut: minOf(out).toString(),
  };
}

// ---------------- router ----------------

const protocol = (): Protocol => ({
  chainId: 4663,
  contracts: CONTRACTS,
  uniswap: UNISWAP,
  roles: ROLES,
  fees: { ytFeeBps: 500, zapFeeBps: 10, stockDripShareBps: 6000 },
  disputeWindowSeconds: DAY,
  stockTokens: STOCKS.map((s) => ({
    address: s.address,
    ticker: s.ticker,
    allowed: true,
    dividendIndex: toWad(s.dividendIndex).toString(),
    splitFactor: WAD.toString(),
    pendingProposalId: proposals.find((p) => p.ticker === s.ticker && p.status === "pending")?.proposalId.toString() ?? null,
  })),
  reserves: markets.map((m) => ({
    series: m.series,
    vault: m.vault,
    pt: m.pt,
    yt: m.yt,
    stockToken: m.stock.address,
    reservesRaw: m.tvl.reserves,
    reservesShares: m.tvl.shares,
    ptSupply: m.supply.pt,
    ytSupply: m.supply.yt,
    backingRatio: 1 + (m.series.length % 3) * 0.0004,
    paused: false,
  })),
});

const nextCommentId = { v: 1000 };

export async function demoApi<T>(path: string, init?: RequestInit): Promise<T> {
  await new Promise((r) => setTimeout(r, 120));
  const url = new URL(path, "http://demo");
  const parts = url.pathname.split("/").filter(Boolean);
  const method = (init?.method ?? "GET").toUpperCase();
  const out = (x: unknown) => structuredClone(x) as T;

  if (parts[0] === "markets" && parts.length === 1) {
    const stock = url.searchParams.get("stock")?.toLowerCase();
    return out(markets.filter((m) => !stock || m.stock.ticker?.toLowerCase() === stock || m.stock.address.toLowerCase() === stock));
  }
  if (parts[0] === "markets" && parts.length === 2) return out(findSeries(parts[1]!).detail);
  if (parts[0] === "markets" && parts[2] === "comments") {
    const key = findSeries(parts[1]!).market.series.toUpperCase();
    if (method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { author: Address; body: string };
      const c: Comment = { id: nextCommentId.v++, author: body.author, body: body.body.trim(), createdAt: new Date().toISOString() };
      comments[key] = [c, ...(comments[key] ?? [])];
      return out(c);
    }
    return out({ series: key, comments: comments[key] ?? [], nextBefore: null });
  }
  if (parts[0] === "protocol") return out(protocol());
  if (parts[0] === "calendar") {
    const stock = url.searchParams.get("stock")?.toLowerCase();
    return out(calendar.filter((c) => !stock || c.ticker?.toLowerCase() === stock || c.stockToken.toLowerCase() === stock));
  }
  if (parts[0] === "oracle" && parts[1] === "proposals") return out(proposals);
  if (parts[0] === "users" && parts[2] === "portfolio") return out(portfolio(parts[1]!));
  if (parts[0] === "referrals" && method === "POST") return out({ ok: true });
  if (parts[0] === "referrals" && parts[1]) return out(referrals(parts[1]));
  if (parts[0] === "quote") return out(quote(url.searchParams));
  throw new ApiError(404, `demo: no data for ${url.pathname}`);
}
