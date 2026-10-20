"use client";

import { Addr, Card, ErrorBox, InfoTip, Skeleton } from "@/components/ui";
import { ProposalList } from "@/components/Dividends";
import { EDU } from "@/lib/edu";
import { duration, num } from "@/lib/format";
import { useNow, useProposals, useProtocol } from "@/lib/hooks";

export default function TransparencyPage() {
  const protocol = useProtocol();
  const proposals = useProposals();
  const now = useNow();
  const p = protocol.data;
  const pending = (proposals.data ?? []).filter((x) => x.status === "pending");
  const history = (proposals.data ?? []).filter((x) => x.status !== "pending");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Transparansi</h1>
        <p className="mt-1 text-sm text-muted">Status oracle dividen, cadangan setiap vault, dan alamat kontrak.</p>
      </div>

      <Card>
        <h2 className="flex items-center font-semibold">
          Oracle dividen
          <InfoTip text={EDU.oracle} label="Oracle" />
        </h2>
        <p className="mt-1 text-xs text-muted">Usulan dalam masa sanggah 24 jam</p>
        {proposals.isLoading && <Skeleton className="mt-3 h-12" />}
        {pending.length === 0 && proposals.data && <p className="py-3 text-sm text-muted">Tidak ada usulan yang sedang menunggu.</p>}
        <ul className="divide-y divide-line">
          {pending.map((x) => {
            const left = Math.max(0, Date.parse(x.disputeEndsAt) - now) / 1000;
            return (
              <li key={x.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium">
                    {x.ticker} · {x.kind === "split" ? `Stock split ${Number(x.splitRatio.toFixed(2))}:1` : `Dividen ${num(x.dividendPct, 2)}%`}
                  </p>
                  <p className="text-xs text-muted">diusulkan oleh <span className="font-mono">{x.proposer.slice(0, 8)}…</span></p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${x.confirmable ? "bg-up/15 text-up" : "bg-warn/15 text-warn"}`}>
                  {x.confirmable || left === 0 ? "Siap dikonfirmasi" : `Sanggah ${duration(left)}`}
                </span>
              </li>
            );
          })}
        </ul>
        <h3 className="mt-4 text-sm font-semibold">Riwayat</h3>
        <ProposalList proposals={history} />
      </Card>

      <Card>
        <h2 className="flex items-center font-semibold">
          Cadangan per vault
          <InfoTip text={EDU.backing} label="Cadangan" />
        </h2>
        {protocol.isLoading && <Skeleton className="mt-3 h-20" />}
        {protocol.isError && <ErrorBox error={protocol.error} />}
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-2 font-normal">Seri</th>
                <th className="py-2 font-normal">Saham di vault</th>
                <th className="py-2 font-normal">PT beredar</th>
                <th className="py-2 text-right font-normal">Rasio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {p?.reserves.map((r) => (
                <tr key={r.vault}>
                  <td className="py-2 font-medium">
                    {r.series}
                    {r.paused && <span className="ml-1 text-xs text-down">pause</span>}
                  </td>
                  <td className="py-2 tabular-nums">{num(r.reservesShares, 4)}</td>
                  <td className="py-2 tabular-nums">{num(Number(r.ptSupply) / 1e18, 4)}</td>
                  <td className={`py-2 text-right tabular-nums ${r.backingRatio !== null && r.backingRatio >= 1 ? "text-up" : "text-down"}`}>
                    {r.backingRatio === null ? "—" : `${r.backingRatio.toFixed(3)}×`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {p && (
        <Card>
          <h2 className="font-semibold">Fee & peran</h2>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between"><dt className="text-muted">Fee klaim YT</dt><dd>{p.fees.ytFeeBps === null ? "—" : `${p.fees.ytFeeBps / 100}%`}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Fee zap</dt><dd>{p.fees.zapFeeBps === null ? "—" : `${p.fees.zapFeeBps / 100}%`}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Bagian Stock Drip</dt><dd>{p.fees.stockDripShareBps === null ? "—" : `${p.fees.stockDripShareBps / 100}%`}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Fee split/merge/redeem</dt><dd>0%</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Owner (multisig + timelock 48 jam)</dt><dd><Addr address={p.roles.owner} /></dd></div>
            {p.roles.guardian && <div className="flex justify-between"><dt className="text-muted">Guardian (pause)</dt><dd><Addr address={p.roles.guardian} /></dd></div>}
            {p.roles.treasury && <div className="flex justify-between"><dt className="text-muted">Treasury</dt><dd><Addr address={p.roles.treasury} /></dd></div>}
            <div className="flex justify-between"><dt className="text-muted">Stock Drip</dt><dd>{p.roles.stockDrip ? <Addr address={p.roles.stockDrip} /> : "belum aktif"}</dd></div>
          </dl>
        </Card>
      )}

      {p && (
        <Card>
          <h2 className="font-semibold">Alamat kontrak</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {[
              ["DrippVaultFactory", p.contracts.factory],
              ["DividendOracle", p.contracts.oracle],
              ["DrippRouter", p.contracts.router],
              ["Uniswap v3 Factory", p.uniswap.v3Factory],
              ["Uniswap Swap Router", p.uniswap.swapRouter],
            ].map(([label, a]) => (
              <li key={label} className="flex justify-between gap-3">
                <span className="text-muted">{label}</span>
                <Addr address={a!} />
              </li>
            ))}
            {p.reserves.map((r) => (
              <li key={r.vault} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                <span className="text-muted">{r.series}</span>
                <span className="flex flex-wrap gap-3">
                  <Addr address={r.vault} label="vault" />
                  <Addr address={r.pt} label={`p${r.series}`} />
                  <Addr address={r.yt} label={`y${r.series}`} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Bukti LP $DRIPP terkunci</h2>
          <p className="mt-1 text-sm text-muted">Alamat pool dan tx hash LP terkunci dari graduasi Pons V2 akan tampil di sini setelah $DRIPP diluncurkan (fase 3).</p>
        </Card>
        <Card>
          <h2 className="font-semibold">Vesting tim</h2>
          <p className="mt-1 text-sm text-muted">Jadwal DrippVesting (cliff + linear) akan tampil di sini setelah kontraknya di-deploy (fase 3).</p>
        </Card>
      </div>
    </div>
  );
}
