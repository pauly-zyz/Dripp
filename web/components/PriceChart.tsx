"use client";

import { useId } from "react";

/** Minimal line chart (Robinhood-style: line + soft gradient, no axes). */
export function PriceChart({ points, height = 140, label }: { points: { t: number; price: number }[]; height?: number; label: string }) {
  const id = useId();
  if (points.length === 0) {
    return (
      <div style={{ height }} className="flex items-center justify-center rounded-2xl text-sm text-muted">
        Belum ada transaksi
      </div>
    );
  }
  const pts = points.length === 1 ? [points[0]!, { ...points[0]!, t: points[0]!.t + 1 }] : points;
  const W = 600;
  const H = height;
  const pad = 8;
  const ts = pts.map((p) => p.t);
  const ps = pts.map((p) => p.price);
  const [t0, t1] = [Math.min(...ts), Math.max(...ts)];
  const [p0, p1] = [Math.min(...ps), Math.max(...ps)];
  const x = (t: number) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * W);
  const y = (p: number) => (p1 === p0 ? H / 2 : pad + (1 - (p - p0) / (p1 - p0)) * (H - 2 * pad));
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
  const up = ps[ps.length - 1]! >= ps[0]!;
  const color = up ? "var(--color-up)" : "var(--color-down)";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={label}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${W},${H} L0,${H} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
