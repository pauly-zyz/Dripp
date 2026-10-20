import Link from "next/link";
import type { Market } from "@/lib/api";
import { daysLeft, num, pct } from "@/lib/format";
import { RiskBadge } from "./Risk";
import { TickerAvatar } from "./ui";

export function MarketRow({ m }: { m: Market }) {
  const date = m.series.split("-").pop();
  return (
    <Link
      href={`/market/${m.series}`}
      className="block rounded-2xl border border-transparent px-2 py-3 transition-colors hover:border-line hover:bg-card md:px-4"
    >
      <div className="flex items-center gap-3">
        <TickerAvatar ticker={m.stock.ticker} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {m.stock.ticker} <span className="text-muted">· {date}</span>
          </p>
          <p className="text-xs text-muted">
            {m.status === "matured" ? "Jatuh tempo" : daysLeft(m.secondsToMaturity)}
            {m.paused && <span className="ml-1 text-down">· di-pause</span>}
          </p>
        </div>
        <div className="text-right">
          <p className={`text-lg font-semibold tabular-nums ${m.impliedFixedApy !== null && m.impliedFixedApy < 0 ? "text-down" : "text-up"}`}>
            {pct(m.impliedFixedApy)}
          </p>
          <p className="text-[11px] text-muted">tetap / tahun</p>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2 pl-[52px] text-xs">
        <div>
          <p className="text-muted">PT</p>
          <p className="tabular-nums">{num(m.ptPrice.shares, 4)}</p>
        </div>
        <div>
          <p className="text-muted">YT</p>
          <p className="tabular-nums">{num(m.ytPrice.shares, 4)}</p>
        </div>
        <div>
          <p className="text-muted">Div. tersirat</p>
          <p className="tabular-nums">{pct(m.impliedDividendApy)}</p>
        </div>
        <div>
          <p className="text-muted">TVL</p>
          <p className="tabular-nums">{m.tvl.usd !== null ? `$${num(m.tvl.usd, 0)}` : num(m.tvl.shares, 1)}</p>
        </div>
      </div>
      <div className="mt-2 pl-[52px]">
        <RiskBadge risk={m.risk} />
      </div>
    </Link>
  );
}
