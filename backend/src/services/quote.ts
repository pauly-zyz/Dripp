import { encodePacked, type Address, type Hex } from "viem";
import { ONE, ZERO_ADDRESS, quoterV2Abi, uniswapV3FactoryAbi, uniswapV3PoolAbi } from "@dripp/shared";
import { eq } from "drizzle-orm";
import { cached } from "../cache.ts";
import { ponder } from "../db.ts";
import { HttpError } from "../util.ts";
import type { Deps } from "./context.ts";
import { getMarket, type MarketSnapshot } from "./markets.ts";

/**
 * Quotes for the web app (Uniswap QuoterV2 via eth_call):
 * - buy:  ETH / USDG / STOCK -> PT | YT | PY through DrippRouter.zap (fee taken from the input first);
 * - sell: PT | YT -> STOCK | USDG through the Uniswap swap router (exactInput).
 * Routes to the stock are tried direct and via WETH / USDG; the best output wins.
 */
export type QuoteToken = "ETH" | "USDG" | "STOCK";
export interface QuoteQuery {
  series: string;
  side: "buy" | "sell";
  asset: "PT" | "YT" | "PY";
  token: QuoteToken;
  amount: bigint;
  slippageBps: number;
}

const FEE_TIERS = [100, 500, 3000, 10000] as const;

interface Route {
  tokens: Address[];
  fees: number[];
}

const encode = (r: Route): Hex => {
  const types: ("address" | "uint24")[] = ["address"];
  const values: (Address | number)[] = [r.tokens[0]!];
  r.fees.forEach((f, i) => {
    types.push("uint24", "address");
    values.push(f, r.tokens[i + 1]!);
  });
  return encodePacked(types, values);
};

const join = (a: Route, b: Route): Route => ({ tokens: [...a.tokens, ...b.tokens.slice(1)], fees: [...a.fees, ...b.fees] });

/** Fee tier of the deepest pool between a and b, or null. Cached for a minute. */
async function bestFee(deps: Deps, a: Address, b: Address): Promise<number | null> {
  const factory = deps.config.deployment.uniswap.v3Factory;
  return cached(deps.cache, `uni:best:${a < b ? a + b : b + a}`, 60, async () => {
    let best: { fee: number; liq: bigint } | null = null;
    for (const fee of FEE_TIERS) {
      const pool = await deps.chain.client.readContract({
        abi: uniswapV3FactoryAbi,
        address: factory,
        functionName: "getPool",
        args: [a, b, fee],
      });
      if (pool === ZERO_ADDRESS) continue;
      const liq = await deps.chain.client.readContract({ abi: uniswapV3PoolAbi, address: pool, functionName: "liquidity" });
      if (liq > 0n && (!best || liq > best.liq)) best = { fee, liq };
    }
    return best?.fee ?? null;
  });
}

/** Candidate routes a -> b: direct, and through each hub token. */
async function routes(deps: Deps, a: Address, b: Address): Promise<Route[]> {
  if (a === b) return [{ tokens: [a], fees: [] }];
  const { weth, usdg } = deps.config.deployment.uniswap;
  const out: Route[] = [];
  const direct = await bestFee(deps, a, b);
  if (direct !== null) out.push({ tokens: [a, b], fees: [direct] });
  for (const hub of [weth, usdg]) {
    if (hub === a || hub === b) continue;
    const [f1, f2] = await Promise.all([bestFee(deps, a, hub), bestFee(deps, hub, b)]);
    if (f1 !== null && f2 !== null) out.push({ tokens: [a, hub, b], fees: [f1, f2] });
  }
  return out;
}

async function quotePath(deps: Deps, route: Route, amountIn: bigint): Promise<bigint | null> {
  if (route.fees.length === 0) return amountIn;
  try {
    const { result } = await deps.chain.client.simulateContract({
      abi: quoterV2Abi,
      address: deps.config.deployment.uniswap.quoterV2,
      functionName: "quoteExactInput",
      args: [encode(route), amountIn],
    });
    return result[0];
  } catch {
    return null;
  }
}

async function best(deps: Deps, candidates: Route[], amountIn: bigint) {
  let top: { route: Route; out: bigint } | null = null;
  for (const route of candidates) {
    const out = await quotePath(deps, route, amountIn);
    if (out !== null && (!top || out > top.out)) top = { route, out };
  }
  if (!top) throw new HttpError(422, "no route with liquidity");
  return top;
}

function sidePool(m: MarketSnapshot, side: "PT" | "YT") {
  const p = m.pools.filter((x) => x.side === side).sort((a, b) => b.liquidityShares - a.liquidityShares)[0];
  if (!p) throw new HttpError(422, `no ${side} pool for ${m.series}`);
  return p;
}

export async function getQuote(deps: Deps, q: QuoteQuery) {
  const d = deps.config.deployment;
  if (d.uniswap.quoterV2 === ZERO_ADDRESS) throw new HttpError(503, "QuoterV2 not configured in the deployment");
  if (q.amount <= 0n) throw new HttpError(400, "amount must be positive");
  if (q.slippageBps < 0 || q.slippageBps > 5_000) throw new HttpError(400, "slippageBps out of range");
  const m = await getMarket(deps, q.series);
  const stock = m.stock.address;
  const tokenAddr: Record<QuoteToken, Address> = { ETH: d.uniswap.weth, USDG: d.uniswap.usdg, STOCK: stock };
  const minOf = (out: bigint) => (out * BigInt(10_000 - q.slippageBps)) / 10_000n;

  if (q.side === "buy") {
    const [proto] = await deps.db.select().from(ponder.protocol).where(eq(ponder.protocol.id, "factory"));
    const zapFeeBps = BigInt(proto?.zapFeeBps ?? 10);
    const fee = (q.amount * zapFeeBps) / 10_000n;
    const net = q.amount - fee;
    const tokenIn = tokenAddr[q.token];
    const toStock = await routes(deps, tokenIn, stock);

    let route: Route;
    let amountOut: bigint;
    if (q.asset === "PY") {
      const top = await best(deps, toStock, net);
      route = top.route;
      amountOut = (top.out * BigInt(m.index)) / ONE; // previewSplit
    } else {
      const pool = sidePool(m, q.asset);
      const last: Route = { tokens: [stock, q.asset === "PT" ? m.pt : m.yt], fees: [pool.fee] };
      const top = await best(deps, toStock.map((r) => join(r, last)), net);
      route = top.route;
      amountOut = top.out;
    }
    return {
      side: "buy" as const,
      series: m.series,
      asset: q.asset,
      to: d.router,
      method: "zap" as const,
      /** DrippRouter.zap params (deadline is set by the client). */
      params: {
        vault: m.vault,
        target: ["PT", "YT", "PY"].indexOf(q.asset),
        tokenIn: q.token === "ETH" ? ZERO_ADDRESS : tokenIn,
        amountIn: q.amount.toString(),
        path: route.fees.length ? encode(route) : "0x",
        minOut: minOf(amountOut).toString(),
      },
      value: q.token === "ETH" ? q.amount.toString() : "0",
      approve: q.token === "ETH" ? null : { token: tokenIn, spender: d.router, amount: q.amount.toString() },
      route: route.tokens,
      fee: fee.toString(),
      amountOut: amountOut.toString(),
      minOut: minOf(amountOut).toString(),
    };
  }

  if (q.asset === "PY") throw new HttpError(400, "sell PT or YT (or merge PT + YT in the vault)");
  if (q.token === "ETH") throw new HttpError(400, "sell to STOCK or USDG");
  const pool = sidePool(m, q.asset);
  const tokenIn = q.asset === "PT" ? m.pt : m.yt;
  const first: Route = { tokens: [tokenIn, stock], fees: [pool.fee] };
  const tail = await routes(deps, stock, tokenAddr[q.token]);
  const top = await best(deps, tail.map((r) => join(first, r)), q.amount);
  return {
    side: "sell" as const,
    series: m.series,
    asset: q.asset,
    to: d.uniswap.swapRouter,
    method: "exactInput" as const,
    legacyRouter: d.uniswap.legacyRouter,
    params: { path: encode(top.route), amountIn: q.amount.toString(), minOut: minOf(top.out).toString() },
    value: "0",
    approve: { token: tokenIn, spender: d.uniswap.swapRouter, amount: q.amount.toString() },
    route: top.route.tokens,
    fee: "0",
    amountOut: top.out.toString(),
    minOut: minOf(top.out).toString(),
  };
}
