/**
 * Pricing math for Dripp series.
 *
 * Units: a "share" is the series unit (1 PT + 1 YT = 1 share). One raw stock token is worth
 * `index / 1e18` shares, where `index` is the vault's current index (DrippVault.currentIndex()).
 * PT pays exactly 1 share at maturity, so its price in shares is a zero-coupon discount factor.
 */

export const ONE = 10n ** 18n;
export const Q96 = 2n ** 96n;
export const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
export const DAY = 24 * 60 * 60;

/** token1 per token0 (raw units) from a Uniswap v3 sqrtPriceX96. */
export function priceFromSqrtPriceX96(sqrtPriceX96: bigint): number {
  const r = Number(sqrtPriceX96) / Number(Q96);
  return r * r;
}

/** Raw stock tokens per raw unit of `token` in a (token, stock) pool. Both have 18 decimals in Dripp. */
export function tokenPriceInStock(sqrtPriceX96: bigint, token: string, stock: string): number {
  const p = priceFromSqrtPriceX96(sqrtPriceX96);
  if (p === 0) return 0;
  return token.toLowerCase() < stock.toLowerCase() ? p : 1 / p;
}

/** Converts a price in raw stock tokens into a price in shares (series units). */
export function toSharePrice(priceInStock: number, index: bigint): number {
  return (priceInStock * Number(index)) / 1e18;
}

/**
 * Annualized yield implied by a discount factor `price` (in shares) paid back as 1 share after
 * `secondsToMaturity`. Returns null when it cannot be computed meaningfully (matured, < 1 day, price <= 0).
 */
export function impliedApy(price: number, secondsToMaturity: number): number | null {
  if (!(price > 0) || secondsToMaturity < DAY) return null;
  return Math.pow(1 / price, SECONDS_PER_YEAR / secondsToMaturity) - 1;
}

/** Fixed yield locked in by buying PT at `ptPriceShares` ("imbal hasil tetap tersirat"). */
export function impliedFixedApy(ptPriceShares: number, secondsToMaturity: number): number | null {
  return impliedApy(ptPriceShares, secondsToMaturity);
}

/**
 * Dividend yield the market expects, implied by the YT price ("dividen tersirat"):
 * PT + YT = 1 share, so the YT price implies a PT price of 1 - YT.
 */
export function impliedDividendApy(ytPriceShares: number, secondsToMaturity: number): number | null {
  if (!(ytPriceShares >= 0) || ytPriceShares >= 1) return null;
  return impliedApy(1 - ytPriceShares, secondsToMaturity);
}

/** Annualized dividend growth of the oracle dividend index between two observations. */
export function realizedDividendApy(
  indexThen: bigint,
  indexNow: bigint,
  seconds: number,
  minSeconds = 7 * DAY,
): number | null {
  if (indexThen <= 0n || seconds < minSeconds) return null;
  const growth = Number((indexNow * ONE) / indexThen) / 1e18;
  return Math.pow(growth, SECONDS_PER_YEAR / seconds) - 1;
}

/** Dividend size of a confirmed oracle proposal as a fraction (0.01 = 1%). */
export function dividendFraction(indexBefore: bigint, indexAfter: bigint): number {
  if (indexBefore <= 0n) return 0;
  return Number(((indexAfter - indexBefore) * ONE) / indexBefore) / 1e18;
}

/** bigint with 18 decimals -> float. */
export function fromWad(x: bigint): number {
  return Number(x) / 1e18;
}
