"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { useAccount } from "wagmi";
import { DrippVaultAbi } from "@dripp/shared/browser";
import { Button, Card, Empty, ErrorBox, InfoTip, Skeleton } from "@/components/ui";
import { txUrl } from "@/lib/chain";
import { EDU } from "@/lib/edu";
import { dateShort, num, signedPct, usd, wad } from "@/lib/format";
import { ReferralCard } from "@/components/ReferralCard";
import { usePortfolio } from "@/lib/hooks";
import { useTx } from "@/lib/tx";

const ACTIVITY: Record<string, string> = {
  split: "Split",
  merge: "Merge",
  redeem: "Tebus PT",
  claim: "Klaim dividen",
  "zap:PT": "Zap → PT",
  "zap:YT": "Zap → YT",
  "zap:PY": "Zap → PT+YT",
  "buy:PT": "Beli PT",
  "buy:YT": "Beli YT",
  "sell:PT": "Jual PT",
  "sell:YT": "Jual YT",
};

export default function PortfolioPage() {
  const { address } = useAccount();
  const p = usePortfolio(address);
  const { run, busy } = useTx();

  if (!address) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="text-3xl font-bold">Portofolio</h1>
        <p className="mt-2 text-muted">Hubungkan wallet untuk melihat posisi PT/YT dan dividen Anda.</p>
        <div className="mt-6 flex justify-center">
          <ConnectButton />
        </div>
      </div>
    );
  }
  if (p.isLoading) return <Skeleton className="h-80" />;
  if (p.isError || !p.data) return <ErrorBox error={p.error} />;
  const d = p.data;
  const claimTotalShares = d.claimable.reduce((a, c) => a + c.netShares, 0);
  const matured = d.positions.filter((x) => x.kind === "PT" && x.matured);

  const claimAll = () =>
    run("Klaim semua dividen", async ({ write }) => {
      let last: `0x${string}` | undefined;
      for (const c of d.claimable) {
        last = await write({ address: c.vault, abi: DrippVaultAbi, functionName: "claimYield", args: [address] });
      }
      return last!;
    });

  const totalValueShares = d.positions.reduce((a, x) => a + (x.valueShares ?? 0), 0);
  const pnlTotal = d.pnl.reduce((a, x) => a + x.pnlShares, 0);
  const costTotal = d.pnl.reduce((a, x) => a + x.costShares, 0);
  const pnlTone = pnlTotal >= 0 ? "text-up" : "text-down";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Portofolio</h1>
        <p className="mt-2 text-4xl font-bold tabular-nums">{d.totals.valueUsd !== null ? usd(d.totals.valueUsd) : `${num(totalValueShares, 4)} saham`}</p>
        <p className="text-sm text-muted">Nilai posisi PT/YT (harga pool)</p>
        {d.pnl.length > 0 && (
          <p className={`mt-1 text-sm font-semibold tabular-nums ${pnlTone}`}>
            {pnlTotal >= 0 ? "+" : ""}
            {num(pnlTotal, 4)} saham {costTotal > 0 && `(${signedPct(pnlTotal / costTotal)})`}{" "}
            <span className="font-normal text-muted">PnL total</span>
            <InfoTip text="PnL = nilai posisi sekarang (termasuk dividen yang belum diklaim) + hasil (merge, tebus, jual, dividen diklaim) − modal (split, beli), dalam saham. PT/YT yang diterima lewat transfer dihitung tanpa modal." label="PnL" />
          </p>
        )}
      </div>

      {matured.length > 0 && (
        <div className="rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
          {matured.length} posisi PT sudah jatuh tempo dan bisa ditebus menjadi saham.
        </div>
      )}

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="flex items-center text-sm text-muted">
              Dividen YT yang bisa diklaim
              <InfoTip text={EDU.claim} label="Klaim" />
            </p>
            <p className="text-2xl font-bold tabular-nums text-up">{num(claimTotalShares, 6)} saham</p>
            {d.totals.claimableUsd ? <p className="text-xs text-muted">{usd(d.totals.claimableUsd)}</p> : null}
          </div>
          <Button onClick={claimAll} disabled={d.claimable.length === 0} busy={!!busy} className="h-10 px-4 text-sm">
            Claim All
          </Button>
        </div>
        {d.claimable.length > 0 && (
          <ul className="mt-3 divide-y divide-line text-sm">
            {d.claimable.map((c) => (
              <li key={c.vault} className="flex justify-between py-2">
                <span>{c.series}</span>
                <span className="tabular-nums">
                  {num(c.netShares, 6)} saham{" "}
                  <span className="text-xs text-muted">(setelah fee {num(wad(c.fee), 6)} token {c.ticker})</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <section>
        <h2 className="mb-2 font-semibold">Posisi</h2>
        {d.positions.length === 0 ? (
          <Empty title="Belum ada posisi" body="Mulai dari Fixed Income untuk membeli PT, atau buka sebuah seri." />
        ) : (
          <ul className="divide-y divide-line/60">
            {d.positions.map((x) => (
              <li key={x.token}>
                <Link href={`/market/${x.series}`} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-semibold">
                      {x.kind} <span className="text-muted">· {x.series}</span>
                    </p>
                    <p className="text-xs text-muted">
                      {num(wad(x.balance), 4)} {x.kind} · jatuh tempo {x.maturity ? dateShort(x.maturity) : "—"}
                      {x.redeemable && <span className="ml-1 text-warn">· bisa ditebus</span>}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular-nums">{x.valueUsd !== null ? usd(x.valueUsd) : `${num(x.valueShares, 4)} saham`}</p>
                    <p className="text-xs text-muted">@ {num(x.price?.shares, 4)}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {d.pnl.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">PnL per seri</h2>
          <ul className="divide-y divide-line/60 text-sm">
            {d.pnl.map((x) => (
              <li key={x.vault} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="font-medium">{x.series}</p>
                  <p className="text-xs text-muted">
                    modal {num(x.costShares, 4)} · hasil {num(x.proceedsShares, 4)} · nilai {num(x.valueShares, 4)} saham
                  </p>
                </div>
                <p className={`text-right font-semibold tabular-nums ${x.pnlShares >= 0 ? "text-up" : "text-down"}`}>
                  {x.pnlShares >= 0 ? "+" : ""}
                  {num(x.pnlShares, 4)}
                  <span className="block text-xs font-normal">{x.pnlPct === null ? "" : signedPct(x.pnlPct)}</span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ReferralCard address={address} />

      <section>
        <h2 className="mb-2 font-semibold">Aktivitas</h2>
        <ul className="divide-y divide-line/60 text-sm">
          {d.activity.map((a, i) => (
            <li key={`${a.txHash}-${i}`} className="flex justify-between py-2.5">
              <span>{ACTIVITY[a.type] ?? a.type}</span>
              <span className="text-xs text-muted">
                {dateShort(a.time)}
                {txUrl(a.txHash) && (
                  <a className="ml-2 underline" href={txUrl(a.txHash)!} target="_blank" rel="noreferrer">
                    tx
                  </a>
                )}
              </span>
            </li>
          ))}
          {d.activity.length === 0 && <li className="py-4 text-center text-muted">Belum ada aktivitas.</li>}
        </ul>
      </section>
    </div>
  );
}
