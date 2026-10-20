"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { ToastProvider, useToast } from "@/components/Toast";
import { DEMO, WS_URL, type Market } from "@/lib/api";
import { wagmiConfig } from "@/lib/chain";

/** Live prices and dividend notifications over the backend WebSocket. */
function LiveUpdates() {
  const qc = useQueryClient();
  const toast = useToast();
  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => ws?.send(JSON.stringify({ type: "subscribe", channels: ["prices", "dividends"] }));
      ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data));
        if (msg.type === "prices") {
          qc.setQueryData<Market[]>(["markets"], (old) =>
            old?.map((m) => {
              const u = msg.data.find((x: { vault: string }) => x.vault === m.vault);
              return u ? { ...m, ...u } : m;
            }),
          );
        } else if (msg.type === "dividend") {
          const d = msg.data;
          const what =
            msg.event === "scheduled"
              ? `Perubahan multiplier ${d.ticker ?? ""} dijadwalkan`
              : `${d.kind === "split" ? "Stock split" : "Dividen"} ${d.ticker ?? ""} ${
                  msg.event === "proposed" ? "diusulkan" : msg.event === "confirmed" ? "dikonfirmasi" : "disanggah"
                }`;
          toast({ kind: "info", title: what, body: d.kind === "dividend" ? `${Number(d.dividendPct).toFixed(2)}%` : undefined });
          qc.invalidateQueries({ queryKey: ["proposals"] });
          qc.invalidateQueries({ queryKey: ["calendar"] });
        }
      };
      ws.onclose = () => {
        if (!stopped) retry = setTimeout(connect, 5000);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [qc, toast]);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <RainbowKitProvider
          theme={darkTheme({ accentColor: "#00c805", accentColorForeground: "#000", borderRadius: "large" })}
          modalSize="compact"
        >
          <ToastProvider>
            {!DEMO && <LiveUpdates />}
            {children}
          </ToastProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
