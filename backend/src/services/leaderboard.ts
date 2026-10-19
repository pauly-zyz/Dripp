import type { Address } from "viem";
import { ponder } from "../db.ts";
import { wadToNumber } from "../util.ts";
import type { Deps } from "./context.ts";
import { getMarkets } from "./markets.ts";
import { getReferralRows } from "./referrals.ts";

/**
 * Points (MVP formula, see backend/README.md):
 *   1 point per share of PT/YT swap volume + 10 per share of YT yield claimed
 *   + 0.1 per share split + 1 per zap; referrers get 10% of their referees' points on top.
 * Daily point snapshots and boosts for $DRIPP stakers come later (SPEC phase 3).
 */
export const POINTS = { volume: 1, yield: 10, split: 0.1, zap: 1, referralShare: 0.1 } as const;

export interface TraderStats {
  address: Address;
  volumeShares: number;
  yieldClaimedShares: number;
  splitShares: number;
  swaps: number;
  zaps: number;
  basePoints: number;
  referralPoints: number;
  points: number;
  referrer: Address | null;
  referees: number;
}

export async function computeTraderStats(deps: Deps): Promise<Map<Address, TraderStats>> {
  const [rows, markets, refs] = await Promise.all([
    deps.db.select().from(ponder.traderSeries),
    getMarkets(deps),
    getReferralRows(deps),
  ]);
  const index = new Map(markets.map((m) => [m.vault, Number(m.index) / 1e18]));
  const stats = new Map<Address, TraderStats>();
  const get = (address: Address) => {
    let s = stats.get(address);
    if (!s) {
      s = {
        address,
        volumeShares: 0,
        yieldClaimedShares: 0,
        splitShares: 0,
        swaps: 0,
        zaps: 0,
        basePoints: 0,
        referralPoints: 0,
        points: 0,
        referrer: null,
        referees: 0,
      };
      stats.set(address, s);
    }
    return s;
  };
  for (const r of rows) {
    const s = get(r.account);
    const idx = index.get(r.vault) ?? 1;
    s.volumeShares += wadToNumber(r.swapVolumeShares);
    s.yieldClaimedShares += wadToNumber(r.yieldClaimed) * idx;
    s.splitShares += wadToNumber(r.splitAmount) * idx;
    s.swaps += r.swapCount;
    s.zaps += r.zapCount;
  }
  for (const s of stats.values()) {
    s.basePoints =
      s.volumeShares * POINTS.volume + s.yieldClaimedShares * POINTS.yield + s.splitShares * POINTS.split + s.zaps * POINTS.zap;
  }
  for (const r of refs) {
    const referee = get(r.referee as Address);
    referee.referrer = r.referrer as Address;
    const referrer = get(r.referrer as Address);
    referrer.referees += 1;
    referrer.referralPoints += referee.basePoints * POINTS.referralShare;
  }
  for (const s of stats.values()) s.points = round2(s.basePoints + s.referralPoints);
  return stats;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export async function getLeaderboard(deps: Deps, q: { metric?: string; limit?: number }) {
  const metric = (["points", "volume", "yield"] as const).find((m) => m === q.metric) ?? "points";
  const key = { points: "points", volume: "volumeShares", yield: "yieldClaimedShares" } as const;
  const list = [...(await computeTraderStats(deps)).values()]
    .filter((s) => s.basePoints > 0 || s.referralPoints > 0)
    .sort((a, b) => b[key[metric]] - a[key[metric]])
    .slice(0, Math.min(q.limit ?? 100, 500));
  return { metric, entries: list.map((s, i) => ({ rank: i + 1, ...s })) };
}

export async function getReferralInfo(deps: Deps, address: Address) {
  const [stats, refs] = await Promise.all([computeTraderStats(deps), getReferralRows(deps)]);
  const me = stats.get(address);
  const referees = refs
    .filter((r) => r.referrer === address)
    .map((r) => ({
      address: r.referee,
      since: r.createdAt.toISOString(),
      points: stats.get(r.referee as Address)?.basePoints ?? 0,
    }));
  return {
    address,
    referralLink: `?ref=${address}`,
    referrer: refs.find((r) => r.referee === address)?.referrer ?? null,
    referees,
    referralPoints: me?.referralPoints ?? 0,
  };
}
