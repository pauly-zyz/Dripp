"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Kind = "info" | "success" | "error";
interface Toast {
  id: number;
  kind: Kind;
  title: string;
  body?: string;
  href?: string | null;
}

const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(Ctx);

let next = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = next++;
    setToasts((xs) => [...xs.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), t.kind === "error" ? 9000 : 6000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto w-full max-w-md rounded-2xl border px-4 py-3 shadow-xl backdrop-blur ${
              t.kind === "error"
                ? "border-down/40 bg-down/15"
                : t.kind === "success"
                  ? "border-up/40 bg-up/15"
                  : "border-line bg-card/95"
            }`}
          >
            <p className="text-sm font-semibold">{t.title}</p>
            {t.body && <p className="mt-0.5 text-xs text-muted break-words">{t.body}</p>}
            {t.href && (
              <a href={t.href} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-up underline">
                Lihat transaksi
              </a>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
