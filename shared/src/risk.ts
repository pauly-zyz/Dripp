import { SECONDS_PER_YEAR } from "./math.ts";

/**
 * Series risk score, 0 (safest) .. 100 (riskiest), from SPEC.md "Skor risiko per seri":
 * liquidity depth of the PT/YT pools, time to maturity, dividend oracle status and holder concentration.
 */
export interface RiskInputs {
  /** Value locked in the series' PT and YT pools, in shares. */
  poolLiquidityShares: number;
  /** Series TVL (vault reserves), in shares. */
  tvlShares: number;
  secondsToMaturity: number;
  /** A dividend/split proposal for the stock is inside its 24h dispute window. */
  pendingProposal: boolean;
  /** Proposals for the stock disputed in the last 30 days. */
  recentDisputes: number;
  /** Share (0..1) of the YT (or PT, whichever is higher) supply held by the 5 largest holders. */
  top5HolderShare: number;
}

export interface RiskScore {
  score: number;
  level: "low" | "medium" | "high";
  components: { liquidity: number; maturity: number; oracle: number; concentration: number };
}

export const RISK_WEIGHTS = { liquidity: 40, maturity: 20, oracle: 25, concentration: 15 } as const;

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 1);

export function riskScore(i: RiskInputs): RiskScore {
  // Pools holding >= 50% of the series TVL count as deep.
  const depth = i.tvlShares > 0 ? i.poolLiquidityShares / i.tvlShares : i.poolLiquidityShares > 0 ? 1 : 0;
  const liquidity = RISK_WEIGHTS.liquidity * (1 - clamp01(depth / 0.5));
  // Longer duration = more exposure to dividend expectations; 2+ years is the maximum.
  const maturity = RISK_WEIGHTS.maturity * clamp01(Math.max(0, i.secondsToMaturity) / (2 * SECONDS_PER_YEAR));
  const oracle = Math.min(RISK_WEIGHTS.oracle, (i.pendingProposal ? 12 : 0) + 8 * Math.max(0, i.recentDisputes));
  // 20% or less in the top 5 is fine; 80%+ is maximal.
  const concentration = RISK_WEIGHTS.concentration * clamp01((i.top5HolderShare - 0.2) / 0.6);

  const score = Math.round(liquidity + maturity + oracle + concentration);
  return {
    score,
    level: score < 30 ? "low" : score < 60 ? "medium" : "high",
    components: {
      liquidity: round1(liquidity),
      maturity: round1(maturity),
      oracle: round1(oracle),
      concentration: round1(concentration),
    },
  };
}

const round1 = (x: number) => Math.round(x * 10) / 10;
