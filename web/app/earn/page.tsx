"use client";

import { useEffect, useMemo, useState } from "react";
import { TradePanel } from "@/components/TradePanel";
import { Card, Chip, Empty, ErrorBox, InfoTip, Skeleton } from "@/components/ui";
import { RiskBadge } from "@/components/Risk";
import { EDU } from "@/lib/edu";
import { dateShort, daysLeft, pct } from "@/lib/format";
import { useMarkets } from "@/lib/hooks";

/** Fixed Income mode: pick stock + maturity, see the fixed yield, buy PT in one click (zap from ETH/USDG). */
export default function EarnPage() {
  const markets = useMarkets();
  const active = useMemo(() => (markets.data ?? []).filter((m) => m.status === "active" && !m.paused), [markets.data]);
  const tickers = useMemo(() => [...new Set(active.map((m) => m.stock.ticker ?? "?"))].sort(), [active]);
  const [stock, setStock] = useState<string | null>(null);
  const [series, setSeries] = useState<string | null>(null);

  useEffect(() => {
    if (!stock && tickers.length) setStock(tickers[0]!);
  }, [tickers, stock]);
  const options = active.filter((m) => m.stock.ticker === stock).sort((a, b) => a.maturity - b.maturity);
  const selected = options.find((m) => m.series === series) ?? options[0];

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-3xl font-bold tracking-tight">Fixed Income</h1>
      <p className="mt-1 text-sm text-muted">
        Kunci imbal hasil tetap dalam saham: beli PT sekarang, terima saham penuh saat jatuh tempo.
        <InfoTip text={EDU.pt} label="PT" />
      </p>

      {markets.isLoading && <Skeleton className="mt-6 h-64" />}
      {markets.isError && <ErrorBox error={markets.error} />}
      {markets.data && active.length === 0 && <Empty title="Belum ada seri aktif" />}

      {selected && (
        <>
          <p className="mt-6 text-xs font-medium uppercase tracking-wide text-muted">Saham</p>
          <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4">
            {tickers.map((t) => (
              <Chip key={t} active={stock === t} onClick={() => { setStock(t); setSeries(null); }}>
                {t}
              </Chip>
            ))}
          </div>

          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">Jatuh tempo</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {options.map((m) => (
              <button
                key={m.series}
                onClick={() => setSeries(m.series)}
                aria-pressed={m.series === selected.series}
                className={`rounded-2xl border p-3 text-left transition-colors ${
                  m.series === selected.series ? "border-up bg-up/10" : "border-line hover:border-muted"
                }`}
              >
                <p className="text-sm font-semibold">{dateShort(m.maturityDate)}</p>
                <p className="text-lg font-bold tabular-nums text-up">{pct(m.impliedFixedApy)}</p>
                <p className="text-[11px] text-muted">{daysLeft(m.secondsToMaturity)}</p>
              </button>
            ))}
          </div>

          <Card className="mt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="flex items-center text-sm text-muted">
                  Imbal hasil tetap
                  <InfoTip text={EDU.fixedApy} label="Imbal hasil tetap" />
                </p>
                <p className={`text-4xl font-bold tabular-nums ${selected.impliedFixedApy !== null && selected.impliedFixedApy < 0 ? "text-down" : "text-up"}`}>
                  {pct(selected.impliedFixedApy)}
                </p>
                <p className="text-xs text-muted">
                  per tahun, sampai {dateShort(selected.maturityDate)} · {selected.series}
                </p>
              </div>
              <RiskBadge risk={selected.risk} />
            </div>
            <div className="mt-5">
              <TradePanel key={selected.series} market={selected} modes={["buy"]} lockAsset="PT" />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
