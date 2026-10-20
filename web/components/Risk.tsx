import type { RiskScore } from "@/lib/api";
import { EDU } from "@/lib/edu";
import { InfoTip } from "./ui";

const LEVEL = {
  low: { label: "Rendah", cls: "text-up border-up/40 bg-up/10", bar: "bg-up" },
  medium: { label: "Sedang", cls: "text-warn border-warn/40 bg-warn/10", bar: "bg-warn" },
  high: { label: "Tinggi", cls: "text-down border-down/40 bg-down/10", bar: "bg-down" },
} as const;

export function RiskBadge({ risk }: { risk: RiskScore }) {
  const l = LEVEL[risk.level];
  return (
    <span
      title={`Skor risiko ${risk.score}/100`}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums ${l.cls}`}
    >
      Risiko {risk.score}
    </span>
  );
}

const PARTS = [
  { key: "liquidity", label: "Likuiditas pool PT/YT", max: 40, hint: "Makin dangkal pool, makin besar selisih harga saat beli/jual." },
  { key: "maturity", label: "Waktu ke jatuh tempo", max: 20, hint: "Tenor panjang lebih sensitif ke perubahan ekspektasi dividen." },
  { key: "oracle", label: "Status oracle dividen", max: 25, hint: "Naik jika ada usulan dalam masa sanggah 24 jam atau sanggahan baru-baru ini." },
  { key: "concentration", label: "Konsentrasi pemegang", max: 15, hint: "Porsi 5 pemegang terbesar PT/YT." },
] as const;

export function RiskCard({ risk }: { risk: RiskScore }) {
  const l = LEVEL[risk.level];
  return (
    <div>
      <div className="flex items-end justify-between">
        <p className="flex items-center text-sm text-muted">
          Skor risiko
          <InfoTip text={EDU.risk} label="Skor risiko" />
        </p>
        <p className="text-2xl font-bold tabular-nums">
          {risk.score}
          <span className="text-sm font-medium text-muted">/100</span>
          <span className={`ml-2 rounded-full border px-2 py-0.5 align-middle text-xs ${l.cls}`}>{l.label}</span>
        </p>
      </div>
      <ul className="mt-4 space-y-3">
        {PARTS.map((p) => {
          const v = risk.components[p.key];
          return (
            <li key={p.key}>
              <div className="flex justify-between text-xs">
                <span className="flex items-center text-muted">
                  {p.label}
                  <InfoTip text={p.hint} label={p.label} />
                </span>
                <span className="tabular-nums">
                  {v}/{p.max}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-card-2">
                <div className={`h-1.5 rounded-full ${l.bar}`} style={{ width: `${(v / p.max) * 100}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
