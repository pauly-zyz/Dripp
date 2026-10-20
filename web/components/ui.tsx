"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { addressUrl } from "@/lib/chain";
import { shortAddr } from "@/lib/format";

/** Small "i" button with an education popover (tap on mobile, hover/focus on desktop). */
export function InfoTip({ text, label = "Info" }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-muted/60 text-[10px] leading-none text-muted hover:border-fg hover:text-fg"
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-6 left-1/2 z-50 w-64 -translate-x-1/2 rounded-xl border border-line bg-card-2 p-3 text-left text-xs font-normal leading-relaxed text-fg shadow-2xl"
        >
          {text}
        </span>
      )}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-card p-4 ${className}`}>{children}</section>;
}

export function Stat({ label, value, tip, tone }: { label: string; value: ReactNode; tip?: string; tone?: "up" | "down" }) {
  return (
    <div>
      <p className="flex items-center text-xs text-muted">
        {label}
        {tip && <InfoTip text={tip} label={label} />}
      </p>
      <p className={`mt-0.5 text-base font-semibold tabular-nums ${tone === "up" ? "text-up" : tone === "down" ? "text-down" : ""}`}>
        {value}
      </p>
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div role="tablist" className="inline-flex rounded-full bg-card-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-full font-medium transition-colors ${size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm"} ${
            value === o.value ? "bg-fg text-bg" : "text-muted hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
        active ? "border-up bg-up/10 text-up" : "border-line text-muted hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  busy,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  busy?: boolean;
  className?: string;
}) {
  const styles = {
    primary: "bg-up text-black hover:brightness-110 disabled:bg-card-2 disabled:text-muted",
    secondary: "bg-card-2 text-fg hover:bg-line disabled:text-muted",
    ghost: "text-up hover:bg-up/10 disabled:text-muted",
  }[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex h-12 items-center justify-center rounded-full px-5 text-base font-semibold transition disabled:cursor-not-allowed ${styles} ${className}`}
    >
      {busy ? <span className="animate-pulse">Memproses…</span> : children}
    </button>
  );
}

export function Skeleton({ className = "h-16" }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-card ${className}`} />;
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-4 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {body && <p className="mt-1 text-sm text-muted">{body}</p>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="rounded-2xl border border-down/40 bg-down/10 px-4 py-3 text-sm text-down">
      {error instanceof Error ? error.message : "Gagal memuat data"}
    </div>
  );
}

export function Addr({ address, label }: { address: string; label?: string }) {
  const url = addressUrl(address);
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="text-fg underline decoration-line underline-offset-2 hover:decoration-fg">
          {label ?? shortAddr(address)}
        </a>
      ) : (
        <span>{label ?? shortAddr(address)}</span>
      )}
      <button
        aria-label="Salin alamat"
        className="text-muted hover:text-fg"
        onClick={() => {
          navigator.clipboard?.writeText(address);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? "✓" : "⧉"}
      </button>
    </span>
  );
}

export function TickerAvatar({ ticker }: { ticker: string | null }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card-2 text-xs font-bold tracking-tight">
      {(ticker ?? "?").slice(0, 4)}
    </span>
  );
}
