export const pct = (x: number | null | undefined, digits = 2) =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(digits)}%`;

export const signedPct = (x: number | null | undefined, digits = 2) =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`;

export const num = (x: number | null | undefined, digits = 4) =>
  x === null || x === undefined || !Number.isFinite(x)
    ? "—"
    : x.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: Math.min(2, digits) });

export const usd = (x: number | null | undefined) =>
  x === null || x === undefined || !Number.isFinite(x)
    ? "—"
    : x.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** Raw 18-decimal integer string -> number. */
export const wad = (x: string | bigint | null | undefined, decimals = 18) =>
  x === null || x === undefined ? 0 : Number(x) / 10 ** decimals;

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export const dateShort = (d: string | number) => {
  const x = typeof d === "number" ? new Date(d * 1000) : new Date(d);
  return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
};

export const daysLeft = (seconds: number) => {
  if (seconds <= 0) return "jatuh tempo";
  const d = Math.floor(seconds / 86400);
  if (d >= 1) return `${d} hari lagi`;
  const h = Math.floor(seconds / 3600);
  return h >= 1 ? `${h} jam lagi` : `${Math.max(1, Math.floor(seconds / 60))} menit lagi`;
};

export const duration = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}j ${m}m` : `${m}m ${s % 60}d`;
};
