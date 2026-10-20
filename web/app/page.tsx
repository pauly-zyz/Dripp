"use client";

import { useMemo, useState } from "react";
import { MarketRow } from "@/components/MarketRow";
import { Chip, Empty, ErrorBox, InfoTip, Skeleton } from "@/components/ui";
import { EDU } from "@/lib/edu";
import { useMarkets } from "@/lib/hooks";

export default function MarketsPage() {
  const markets = useMarkets();
  const [stock, setStock] = useState<string | null>(null);
  const [maturity, setMaturity] = useState<string | null>(null);
  const [showMatured, setShowMatured] = useState(false);

  const tickers = useMemo(() => [...new Set((markets.data ?? []).map((m) => m.stock.ticker ?? "?"))].sort(), [markets.data]);
  const maturities = useMemo(
    () =>
      [...new Map((markets.data ?? []).filter((m) => !stock || m.stock.ticker === stock).map((m) => [m.series.split("-").pop()!, m.maturity])).entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([label]) => label),
    [markets.data, stock],
  );
  const list = (markets.data ?? []).filter(
    (m) =>
      (!stock || m.stock.ticker === stock) &&
      (!maturity || m.series.endsWith(`-${maturity}`)) &&
      (showMatured || m.status === "active"),
  );

  return (
    <div>
      <section className="pb-4 pt-2">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Markets</h1>
        <p className="mt-1 text-sm text-muted">
          Split the stock. Trade the drip. Setiap saham dipecah jadi
          <span className="whitespace-nowrap font-medium text-fg"> PT<InfoTip text={EDU.pt} label="PT" /></span> dan
          <span className="whitespace-nowrap font-medium text-fg"> YT<InfoTip text={EDU.yt} label="YT" /></span>.
        </p>
      </section>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
        <Chip active={!stock} onClick={() => { setStock(null); setMaturity(null); }}>Semua</Chip>
        {tickers.map((t) => (
          <Chip key={t} active={stock === t} onClick={() => { setStock(t); setMaturity(null); }}>
            {t}
          </Chip>
        ))}
      </div>
      {maturities.length > 1 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
          <Chip active={!maturity} onClick={() => setMaturity(null)}>Semua tenor</Chip>
          {maturities.map((d) => (
            <Chip key={d} active={maturity === d} onClick={() => setMaturity(d)}>
              {d}
            </Chip>
          ))}
        </div>
      )}

      <div className="mt-2 hidden grid-cols-[1fr_auto] px-4 text-xs text-muted md:grid">
        <span>Seri</span>
        <span className="flex items-center">
          Imbal hasil tetap
          <InfoTip text={EDU.fixedApy} label="Imbal hasil tetap" />
        </span>
      </div>

      <div className="mt-1 divide-y divide-line/60">
        {markets.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="my-2 h-24" />)}
        {markets.isError && <ErrorBox error={markets.error} />}
        {list.map((m) => (
          <MarketRow key={m.vault} m={m} />
        ))}
      </div>
      {markets.data && list.length === 0 && <Empty title="Tidak ada seri" body="Coba filter lain." />}

      {markets.data?.some((m) => m.status === "matured") && (
        <button onClick={() => setShowMatured((s) => !s)} className="mt-4 text-sm text-muted hover:text-fg">
          {showMatured ? "Sembunyikan" : "Tampilkan"} seri yang sudah jatuh tempo
        </button>
      )}
    </div>
  );
}
