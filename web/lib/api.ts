import type { Address, Hex } from "viem";

/** Demo mode serves sample data from lib/demo.ts instead of the backend (previews without a deployment). */
export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";
/** Sample wallet whose portfolio demo mode shows when no wallet is connected. */
export const DEMO_ACCOUNT = "0xd5e0d5e0d5e0d5e0d5e0d5e0d5e0d5e0d5e0d5e0" as Address;

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080").replace(/\/$/, "");
export const WS_URL = API_URL.replace(/^http/, "ws") + "/ws";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (DEMO) return (await import("./demo")).demoApi<T>(path, init);
  const r = await fetch(API_URL + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, (body as { error?: string }).error ?? r.statusText);
  return body as T;
}

// ---------------- types (mirror backend/src/services) ----------------

export interface Price {
  stock: number | null;
  shares: number | null;
  usd: number | null;
}

export interface RiskScore {
  score: number;
  level: "low" | "medium" | "high";
  components: { liquidity: number; maturity: number; oracle: number; concentration: number };
}

export interface Market {
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
  index: string;
  stockSharesPerPT: number;
  sharePriceUsd: number | null;
  ptPrice: Price;
  ytPrice: Price;
  impliedFixedApy: number | null;
  impliedDividendApy: number | null;
  realizedDividendApy: number | null;
  tvl: { reserves: string; shares: number; usd: number | null };
  supply: { pt: string; yt: string };
  depositCap: string | null;
  volume24hShares: number;
  pools: { address: Address; side: "PT" | "YT"; fee: number; tokenReserve: string; stockReserve: string; liquidityShares: number }[];
  risk: RiskScore;
}

export interface Proposal {
  id: string;
  stockToken: Address;
  proposalId: number;
  kind: "dividend" | "split" | "mixed";
  status: "pending" | "confirmed" | "disputed";
  dividendPct: number;
  splitRatio: number;
  fromMultiplier: string;
  toMultiplier: string;
  proposedAt: string;
  disputeEndsAt: string;
  resolvedAt: string | null;
  proposer: Address;
  disputer: Address | null;
  txHash: Hex;
  ticker?: string | null;
  secondsLeftInDisputeWindow?: number;
  confirmable?: boolean;
}

export interface SwapView {
  time: string;
  timestamp: number;
  side: "PT" | "YT";
  type: "buy" | "sell";
  trader: Address;
  amount: string;
  stockAmount: string;
  priceShares: number;
  txHash: Hex;
}

export interface MarketDetail extends Market {
  dividendHistory: Proposal[];
  recentSwaps: SwapView[];
  priceHistory: { PT: { t: number; price: number }[]; YT: { t: number; price: number }[] };
}

export interface CalendarEntry {
  date: string;
  timestamp: number;
  stockToken: Address;
  ticker: string | null;
  type: "scheduled" | "announced" | "proposed" | "confirmed" | "disputed";
  kind: "dividend" | "split" | "mixed" | "unknown";
  dividendPct: number | null;
  splitRatio: number | null;
  source: "erc8056" | "team" | "oracle";
  txHash: Hex | null;
  note: string | null;
}

export interface Claimable {
  series: string;
  vault: Address;
  stockToken: Address;
  ticker: string | null;
  gross: string;
  fee: string;
  net: string;
  netShares: number;
  netUsd: number | null;
}

export interface Position {
  series: string | null;
  vault: Address;
  kind: "PT" | "YT";
  token: Address;
  ticker: string | null;
  balance: string;
  price: Price | null;
  valueShares: number | null;
  valueUsd: number | null;
  maturity: string | null;
  matured: boolean;
  redeemable: boolean;
}

export interface SeriesPnl {
  series: string;
  vault: Address;
  costShares: number;
  proceedsShares: number;
  valueShares: number;
  pnlShares: number;
  pnlPct: number | null;
  pnlUsd: number | null;
}

export interface Portfolio {
  account: Address;
  positions: Position[];
  claimable: Claimable[];
  pnl: SeriesPnl[];
  totals: { valueUsd: number | null; claimableUsd: number | null };
  maturityReminders: { series: string | null; maturity: string | null; matured: boolean }[];
  activity: { type: string; vault: Address; timestamp: number; time: string; txHash: Hex; [k: string]: unknown }[];
}

export interface Protocol {
  chainId: number;
  contracts: { factory: Address; oracle: Address; router: Address; owner: Address };
  uniswap: { v3Factory: Address; swapRouter: Address; legacyRouter: boolean; quoterV2: Address; weth: Address; usdg: Address };
  roles: { owner: Address; guardian: Address | null; treasury: Address | null; stockDrip: Address | null };
  fees: { ytFeeBps: number | null; zapFeeBps: number | null; stockDripShareBps: number | null };
  disputeWindowSeconds: number;
  stockTokens: { address: Address; ticker: string | null; allowed: boolean; dividendIndex: string | null; splitFactor: string | null; pendingProposalId: string | null }[];
  reserves: {
    series: string;
    vault: Address;
    pt: Address;
    yt: Address;
    stockToken: Address;
    reservesRaw: string;
    reservesShares: number;
    ptSupply: string;
    ytSupply: string;
    backingRatio: number | null;
    paused: boolean;
  }[];
}

export type QuoteToken = "ETH" | "USDG" | "STOCK";

export interface BuyQuote {
  side: "buy";
  series: string;
  asset: "PT" | "YT" | "PY";
  to: Address;
  method: "zap";
  params: { vault: Address; target: number; tokenIn: Address; amountIn: string; path: Hex; minOut: string };
  value: string;
  approve: { token: Address; spender: Address; amount: string } | null;
  route: Address[];
  fee: string;
  amountOut: string;
  minOut: string;
}

export interface SellQuote {
  side: "sell";
  series: string;
  asset: "PT" | "YT";
  to: Address;
  method: "exactInput";
  legacyRouter: boolean;
  params: { path: Hex; amountIn: string; minOut: string };
  value: string;
  approve: { token: Address; spender: Address; amount: string };
  route: Address[];
  fee: string;
  amountOut: string;
  minOut: string;
}

export interface Comment {
  id: number;
  author: Address;
  body: string;
  createdAt: string;
}

export const commentMessage = (series: string, timestamp: number, body: string) =>
  `Dripp comment\nSeries: ${series}\nTimestamp: ${timestamp}\n\n${body}`;

export const referralMessage = (referrer: string, referee: string) =>
  `Dripp referral\nReferrer: ${referrer.toLowerCase()}\nReferee: ${referee.toLowerCase()}`;
