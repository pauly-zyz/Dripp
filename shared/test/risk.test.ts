import { describe, expect, it } from "vitest";
import { SECONDS_PER_YEAR } from "../src/math.ts";
import { riskScore } from "../src/risk.ts";

const base = {
  poolLiquidityShares: 500,
  tvlShares: 1000,
  secondsToMaturity: 0,
  pendingProposal: false,
  recentDisputes: 0,
  top5HolderShare: 0.1,
};

describe("riskScore", () => {
  it("deep, matured, quiet, spread out series is 0", () => {
    expect(riskScore(base)).toEqual({
      score: 0,
      level: "low",
      components: { liquidity: 0, maturity: 0, oracle: 0, concentration: 0 },
    });
  });

  it("no liquidity, long maturity, pending + disputed oracle, concentrated holders is 100", () => {
    const r = riskScore({
      poolLiquidityShares: 0,
      tvlShares: 1000,
      secondsToMaturity: 3 * SECONDS_PER_YEAR,
      pendingProposal: true,
      recentDisputes: 2,
      top5HolderShare: 1,
    });
    expect(r.score).toBe(100);
    expect(r.level).toBe("high");
  });

  it("scales each component", () => {
    const r = riskScore({ ...base, poolLiquidityShares: 125, secondsToMaturity: SECONDS_PER_YEAR, pendingProposal: true });
    expect(r.components).toEqual({ liquidity: 30, maturity: 10, oracle: 12, concentration: 0 });
    expect(r.score).toBe(52);
    expect(r.level).toBe("medium");
  });

  it("empty series with no pools counts as illiquid", () => {
    expect(riskScore({ ...base, poolLiquidityShares: 0, tvlShares: 0 }).components.liquidity).toBe(40);
  });
});
