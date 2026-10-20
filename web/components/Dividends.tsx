import type { CalendarEntry, Proposal } from "@/lib/api";
import { txUrl } from "@/lib/chain";
import { dateShort, num } from "@/lib/format";

const STATUS: Record<string, string> = {
  scheduled: "Terjadwal",
  announced: "Diumumkan",
  proposed: "Masa sanggah",
  pending: "Masa sanggah",
  confirmed: "Dikonfirmasi",
  disputed: "Disanggah",
};

const what = (kind: string, dividendPct: number | null, splitRatio: number | null) =>
  kind === "split"
    ? `Stock split ${splitLabel(splitRatio)}`
    : kind === "mixed"
      ? `Split ${splitLabel(splitRatio)} + dividen ${num(dividendPct, 2)}%`
      : kind === "dividend"
        ? `Dividen ${dividendPct === null ? "" : `${num(dividendPct, 2)}%`}`
        : "Perubahan multiplier";

const splitLabel = (r: number | null) => (r === null ? "" : r >= 1 ? `${num(r, 2)}:1` : `1:${num(1 / r, 2)}`);

const dot: Record<string, string> = {
  scheduled: "bg-warn",
  announced: "bg-warn",
  proposed: "bg-warn",
  pending: "bg-warn",
  confirmed: "bg-up",
  disputed: "bg-down",
};

/** Ex-dividend calendar entries (upcoming first). */
export function CalendarList({ entries }: { entries: CalendarEntry[] }) {
  if (entries.length === 0) return <p className="py-4 text-center text-sm text-muted">Belum ada jadwal.</p>;
  const now = Date.now() / 1000;
  const sorted = [...entries].sort((a, b) => {
    const fa = a.timestamp >= now ? 0 : 1;
    const fb = b.timestamp >= now ? 0 : 1;
    return fa - fb || (fa === 0 ? a.timestamp - b.timestamp : b.timestamp - a.timestamp);
  });
  return (
    <ul className="divide-y divide-line">
      {sorted.map((e, i) => (
        <li key={`${e.type}-${e.timestamp}-${i}`} className="flex items-start gap-3 py-3">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot[e.type] ?? "bg-muted"}`} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {e.ticker} · {what(e.kind, e.dividendPct, e.splitRatio)}
            </p>
            <p className="text-xs text-muted">
              {STATUS[e.type]} · {dateShort(e.date)}
              {e.note ? ` · ${e.note}` : ""}
            </p>
          </div>
          {e.txHash && txUrl(e.txHash) && (
            <a href={txUrl(e.txHash)!} target="_blank" rel="noreferrer" className="text-xs text-muted underline">
              tx
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ProposalList({ proposals }: { proposals: Proposal[] }) {
  if (proposals.length === 0) return <p className="py-4 text-center text-sm text-muted">Belum ada riwayat.</p>;
  return (
    <ul className="divide-y divide-line">
      {proposals.map((p) => (
        <li key={p.id} className="flex items-start gap-3 py-3">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot[p.status]}`} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {p.ticker ? `${p.ticker} · ` : ""}
              {what(p.kind, p.kind === "split" ? null : p.dividendPct, p.kind === "dividend" ? null : p.splitRatio)}
            </p>
            <p className="text-xs text-muted">
              {STATUS[p.status]} · diusulkan {dateShort(p.proposedAt)}
              {p.resolvedAt && ` · selesai ${dateShort(p.resolvedAt)}`}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
