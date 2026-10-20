"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Comments } from "@/components/Comments";
import { CalendarList, ProposalList } from "@/components/Dividends";
import { IconBack } from "@/components/Icons";
import { PriceChart } from "@/components/PriceChart";
import { RiskCard } from "@/components/Risk";
import { TradePanel } from "@/components/TradePanel";
import { Card, ErrorBox, InfoTip, Segmented, Skeleton, Stat, TickerAvatar } from "@/components/ui";
import { txUrl } from "@/lib/chain";
import { EDU } from "@/lib/edu";
import { dateShort, daysLeft, num, pct, shortAddr, wad } from "@/lib/format";
import { useCalendar, useMarket } from "@/lib/hooks";
import { impliedDividendApy, impliedFixedApy } from "@dripp/shared/browser";

export default function SeriesPage() {
  const { series } = useParams<{ series: string }>();
  const q = useMarket(series);
  const [side, setSide] = useState<"PT" | "YT">("PT");
  const [view, setView] = useState<"price" | "yield">("price");
  const m = q.data;
  const calendar = useCalendar(m?.stock.ticker ?? undefined);

  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.isError || !m) return <ErrorBox error={q.error} />;

  const price = side === "PT" ? m.ptPrice : m.ytPrice;
  // implied yield at each trade: PT -> fixed APY, YT -> implied dividend (PT = 1 - YT)
  const yieldAt = (p: { t: number; price: number }) =>
    side === "PT" ? impliedFixedApy(p.price, m.maturity - p.t) : impliedDividendApy(p.price, m.maturity - p.t);
  const history =
    view === "price"
      ? m.priceHistory[side]
      : m.priceHistory[side].flatMap((p) => {
          const y = yieldAt(p);
          return y === null ? [] : [{ t: p.t, price: y }];
        });
  const headline = view === "price" ? num(price.shares, 4) : pct(side === "PT" ? m.impliedFixedApy : m.impliedDividendApy);
  const ticker = m.stock.ticker ?? "";

  return (
    <div>
      <Link href="/" className="-ml-1 inline-flex items-center text-sm text-muted hover:text-fg">
        <IconBack width={18} height={18} /> Markets
      </Link>

      <div className="mt-3 grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <header className="flex items-center gap-3">
            <TickerAvatar ticker={ticker} />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{m.series}</h1>
              <p className="flex items-center text-sm text-muted">
                Jatuh tempo {dateShort(m.maturityDate)} · {m.status === "matured" ? "sudah jatuh tempo" : daysLeft(m.secondsToMaturity)}
                <InfoTip text={EDU.maturity} label="Jatuh tempo" />
              </p>
            </div>
          </header>

          <section>
            <div className="flex items-end justify-between">
              <div>
                <p className="flex items-center text-sm text-muted">
                  {view === "price" ? `Harga ${side} (dalam saham)` : side === "PT" ? "Imbal hasil tetap tersirat" : "Dividen tersirat"}
                  {view === "yield" && <InfoTip text={side === "PT" ? EDU.fixedApy : EDU.impliedDividend} label="Imbal hasil" />}
                </p>
                <p className="text-4xl font-bold tabular-nums">{headline}</p>
                {view === "price" && price.usd !== null && <p className="text-sm text-muted">${num(price.usd, 2)}</p>}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <Segmented options={[{ value: "PT", label: "PT" }, { value: "YT", label: "YT" }]} value={side} onChange={setSide} size="sm" />
              <Segmented options={[{ value: "price", label: "Harga" }, { value: "yield", label: "Imbal hasil" }]} value={view} onChange={setView} size="sm" />
            </div>
            <div className="mt-3">
              <PriceChart points={history} label={view === "price" ? `Riwayat harga ${side}` : `Riwayat imbal hasil ${side}`} />
            </div>
          </section>

          <section className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Imbal hasil tetap" tip={EDU.fixedApy} value={pct(m.impliedFixedApy)} tone={m.impliedFixedApy !== null && m.impliedFixedApy < 0 ? "down" : "up"} />
            <Stat label="Dividen tersirat" tip={EDU.impliedDividend} value={pct(m.impliedDividendApy)} />
            <Stat label="Dividen terealisasi" tip={EDU.realizedDividend} value={pct(m.realizedDividendApy)} />
            <Stat label="Harga PT" tip={EDU.pt} value={num(m.ptPrice.shares, 4)} />
            <Stat label="Harga YT" tip={EDU.yt} value={num(m.ytPrice.shares, 4)} />
            <Stat label="TVL" tip={EDU.tvl} value={m.tvl.usd !== null ? `$${num(m.tvl.usd, 0)}` : `${num(m.tvl.shares, 2)} saham`} />
            <Stat label="Volume 24 jam" value={`${num(m.volume24hShares, 2)} saham`} />
            <Stat label="Saham per PT" tip="Naik setelah stock split: PT Anda ditebus menjadi lebih banyak saham." value={num(m.stockSharesPerPT, 4)} />
            <Stat label="Deposit cap" value={m.depositCap === null ? "Tanpa batas" : `${num(wad(m.depositCap), 0)} saham`} />
          </section>

          <Card>
            <RiskCard risk={m.risk} />
          </Card>

          <Card>
            <h2 className="flex items-center font-semibold">
              Kalender ex-dividen {ticker}
              <InfoTip text={EDU.oracle} label="Oracle dividen" />
            </h2>
            <CalendarList entries={calendar.data ?? []} />
          </Card>

          <Card>
            <h2 className="font-semibold">Riwayat dividen & split</h2>
            <ProposalList proposals={m.dividendHistory.map((p) => ({ ...p, ticker }))} />
          </Card>

          <Card>
            <h2 className="font-semibold">Transaksi terakhir</h2>
            <ul className="mt-2 divide-y divide-line text-sm">
              {m.recentSwaps.slice(0, 12).map((s) => (
                <li key={s.txHash + s.side + s.amount} className="flex items-center justify-between py-2">
                  <span>
                    <span className={s.type === "buy" ? "text-up" : "text-down"}>{s.type === "buy" ? "Beli" : "Jual"}</span> {num(wad(s.amount), 3)} {s.side}
                    <span className="ml-2 font-mono text-xs text-muted">{shortAddr(s.trader)}</span>
                  </span>
                  {txUrl(s.txHash) ? (
                    <a href={txUrl(s.txHash)!} target="_blank" rel="noreferrer" className="text-xs text-muted tabular-nums underline">
                      @ {num(s.priceShares, 4)}
                    </a>
                  ) : (
                    <span className="text-xs text-muted tabular-nums">@ {num(s.priceShares, 4)}</span>
                  )}
                </li>
              ))}
              {m.recentSwaps.length === 0 && <li className="py-4 text-center text-muted">Belum ada transaksi.</li>}
            </ul>
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">Diskusi</h2>
            <Comments series={m.series} />
          </Card>
        </div>

        <aside className="min-w-0 md:sticky md:top-20 md:self-start">
          <Card>
            <TradePanel market={m} initialMode={m.status === "matured" ? "redeem" : "buy"} />
          </Card>
        </aside>
      </div>
    </div>
  );
}
