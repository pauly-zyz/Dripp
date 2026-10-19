import { describe, expect, it } from "vitest";
import {
  DAY,
  Q96,
  SECONDS_PER_YEAR,
  dividendFraction,
  impliedDividendApy,
  impliedFixedApy,
  priceFromSqrtPriceX96,
  realizedDividendApy,
  toSharePrice,
  tokenPriceInStock,
} from "../src/math.ts";

describe("pool prices", () => {
  it("sqrtPriceX96 of 2^96 is price 1", () => {
    expect(priceFromSqrtPriceX96(Q96)).toBe(1);
  });

  it("orients the price by token order", () => {
    // sqrt(4) * 2^96 -> token1 per token0 = 4
    const sqrt = 2n * Q96;
    const lo = "0x0000000000000000000000000000000000000001";
    const hi = "0x0000000000000000000000000000000000000002";
    expect(tokenPriceInStock(sqrt, lo, hi)).toBe(4); // token is token0
    expect(tokenPriceInStock(sqrt, hi, lo)).toBe(0.25); // token is token1
  });

  it("converts stock-denominated prices to shares with the index", () => {
    // PT at 0.95 raw stock while 1 raw stock = 1.0 share
    expect(toSharePrice(0.95, 10n ** 18n)).toBeCloseTo(0.95);
    // after a 10% dividend, 1 raw token = 1.1 shares
    expect(toSharePrice(0.5, 11n * 10n ** 17n)).toBeCloseTo(0.55);
  });
});

describe("implied yields", () => {
  it("PT at 0.95 for one year is ~5.26% fixed", () => {
    expect(impliedFixedApy(0.95, SECONDS_PER_YEAR)).toBeCloseTo(1 / 0.95 - 1, 10);
  });

  it("annualizes a half-year discount", () => {
    expect(impliedFixedApy(0.98, SECONDS_PER_YEAR / 2)).toBeCloseTo(Math.pow(1 / 0.98, 2) - 1, 10);
  });

  it("YT price implies the same yield as PT = 1 - YT", () => {
    expect(impliedDividendApy(0.05, SECONDS_PER_YEAR)).toBeCloseTo(impliedFixedApy(0.95, SECONDS_PER_YEAR)!, 10);
  });

  it("returns null when not meaningful", () => {
    expect(impliedFixedApy(0.95, DAY - 1)).toBeNull();
    expect(impliedFixedApy(0, SECONDS_PER_YEAR)).toBeNull();
    expect(impliedDividendApy(1, SECONDS_PER_YEAR)).toBeNull();
  });

  it("realized dividend APY from the oracle index", () => {
    const e = 10n ** 18n;
    expect(realizedDividendApy(e, (e * 102n) / 100n, SECONDS_PER_YEAR)).toBeCloseTo(0.02, 10);
    expect(realizedDividendApy(e, (e * 102n) / 100n, DAY)).toBeNull();
    expect(dividendFraction(e, (e * 103n) / 100n)).toBeCloseTo(0.03, 12);
  });
});
