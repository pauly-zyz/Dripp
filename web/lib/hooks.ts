"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import {
  api,
  type BuyQuote,
  type CalendarEntry,
  type Comment,
  type Market,
  type MarketDetail,
  type Portfolio,
  type Proposal,
  type Protocol,
  type QuoteToken,
  type SellQuote,
} from "./api";

const REFRESH = 15_000;

export const useMarkets = () =>
  useQuery({ queryKey: ["markets"], queryFn: () => api<Market[]>("/markets"), refetchInterval: REFRESH });

export const useMarket = (series: string) =>
  useQuery({
    queryKey: ["market", series.toUpperCase()],
    queryFn: () => api<MarketDetail>(`/markets/${encodeURIComponent(series)}`),
    refetchInterval: REFRESH,
  });

export const useProtocol = () =>
  useQuery({ queryKey: ["protocol"], queryFn: () => api<Protocol>("/protocol"), staleTime: 60_000 });

export const useCalendar = (stock?: string) =>
  useQuery({
    queryKey: ["calendar", stock ?? "all"],
    queryFn: () => api<CalendarEntry[]>(`/calendar${stock ? `?stock=${stock}` : ""}`),
    refetchInterval: 60_000,
  });

export const useProposals = () =>
  useQuery({ queryKey: ["proposals"], queryFn: () => api<Proposal[]>("/oracle/proposals"), refetchInterval: REFRESH });

export const usePortfolio = (address?: Address) =>
  useQuery({
    queryKey: ["portfolio", address],
    queryFn: () => api<Portfolio>(`/users/${address}/portfolio`),
    enabled: !!address,
    refetchInterval: REFRESH,
  });

export const useComments = (series: string) =>
  useQuery({
    queryKey: ["comments", series.toUpperCase()],
    queryFn: () => api<{ comments: Comment[] }>(`/markets/${encodeURIComponent(series)}/comments`),
    refetchInterval: 30_000,
  });

export function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export interface QuoteArgs {
  series: string;
  side: "buy" | "sell";
  asset: "PT" | "YT" | "PY";
  token: QuoteToken;
  amount: bigint;
  slippageBps: number;
}

export function useQuote(args: QuoteArgs | null) {
  const a = useDebounced(args);
  return useQuery({
    queryKey: ["quote", a?.series, a?.side, a?.asset, a?.token, a?.amount.toString(), a?.slippageBps],
    queryFn: () =>
      api<BuyQuote | SellQuote>(
        `/quote?series=${a!.series}&side=${a!.side}&asset=${a!.asset}&token=${a!.token}&amount=${a!.amount}&slippageBps=${a!.slippageBps}`,
      ),
    enabled: !!a && a.amount > 0n,
    staleTime: 10_000,
    refetchInterval: 20_000,
    retry: false,
  });
}

/** Ticks every second (countdowns). */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
