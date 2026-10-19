import { ONE } from "./math.ts";

/**
 * Classifies a Stock Token uiMultiplier change (from -> to) for the DividendOracle keeper.
 *
 * - An announced corporate action (from the calendar) wins when it matches the observed ratio.
 * - Otherwise: an exact "nice" ratio (2:1, 3:2, 1:10, ...) is a split; a rise of less than
 *   `maxDividend` is a dividend; a nice split times a rise below `maxMixedDividend` is mixed.
 * - Anything else is ambiguous and must be handled by the multisig by hand.
 */
export type Classification =
  | { kind: "dividend" }
  | { kind: "split" }
  | { kind: "mixed"; splitRatio: bigint }
  | { kind: "ambiguous"; reason: string };

export type AnnouncedAction = { kind: "dividend" } | { kind: "split"; ratio: [number, number] };

export interface ClassifyOptions {
  /** Largest single dividend accepted automatically, as a fraction. Default 0.15 (15%). */
  maxDividend?: number;
  /** Largest dividend part of an unannounced split + dividend. Default 0.05 (5%). */
  maxMixedDividend?: number;
  /** Relative tolerance for matching a split ratio. Default 1e-6. */
  tolerance?: number;
  announced?: AnnouncedAction;
}

/** Common forward split ratios [new, old]; reverse splits use the reciprocal. */
const NICE_SPLITS: [number, number][] = [
  [50, 1], [30, 1], [25, 1], [20, 1], [15, 1], [10, 1], [8, 1], [7, 1], [6, 1], [5, 1],
  [4, 1], [3, 1], [5, 2], [2, 1], [3, 2], [4, 3], [5, 4],
];

export function ratioToWad([num, den]: [number, number]): bigint {
  return (BigInt(num) * ONE) / BigInt(den);
}

export function classifyMultiplierChange(from: bigint, to: bigint, opts: ClassifyOptions = {}): Classification {
  const maxDividend = opts.maxDividend ?? 0.15;
  const maxMixed = opts.maxMixedDividend ?? 0.05;
  const tol = opts.tolerance ?? 1e-6;
  if (from <= 0n || to <= 0n) return { kind: "ambiguous", reason: "non-positive multiplier" };
  if (from === to) return { kind: "ambiguous", reason: "multiplier unchanged" };
  const r = Number((to * ONE) / from) / 1e18;
  const isDividend = (x: number) => x > 1 + tol && x < 1 + maxDividend;
  const matches = (x: number, s: number) => Math.abs(x / s - 1) <= tol;

  if (opts.announced?.kind === "split") {
    const s = opts.announced.ratio[0] / opts.announced.ratio[1];
    if (matches(r, s)) return { kind: "split" };
    if (isDividend(r / s)) return { kind: "mixed", splitRatio: ratioToWad(opts.announced.ratio) };
    return { kind: "ambiguous", reason: `ratio ${r} does not match announced split ${s}` };
  }
  if (opts.announced?.kind === "dividend") {
    return isDividend(r) ? { kind: "dividend" } : { kind: "ambiguous", reason: `ratio ${r} is not a dividend` };
  }

  for (const [a, b] of NICE_SPLITS) {
    if (matches(r, a / b) || matches(r, b / a)) return { kind: "split" };
  }
  if (isDividend(r)) return { kind: "dividend" };
  const isSmallDividend = (x: number) => x > 1 + tol && x < 1 + maxMixed;
  for (const [a, b] of NICE_SPLITS) {
    if (isSmallDividend(r / (a / b))) return { kind: "mixed", splitRatio: ratioToWad([a, b]) };
    if (isSmallDividend(r / (b / a))) return { kind: "mixed", splitRatio: ratioToWad([b, a]) };
  }
  return { kind: "ambiguous", reason: `unrecognised multiplier ratio ${r}` };
}
