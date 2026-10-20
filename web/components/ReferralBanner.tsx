"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { isAddress } from "viem";
import { useAccount, useSignMessage } from "wagmi";
import { api, referralMessage } from "@/lib/api";
import { useToast } from "./Toast";

const KEY = "dripp:ref";

function Banner() {
  const params = useSearchParams();
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const toast = useToast();
  const qc = useQueryClient();
  const [ref, setRef] = useState<string | null>(null);

  useEffect(() => {
    const fromUrl = params.get("ref");
    try {
      if (fromUrl && isAddress(fromUrl)) localStorage.setItem(KEY, fromUrl.toLowerCase());
      setRef(localStorage.getItem(KEY));
    } catch {
      if (fromUrl && isAddress(fromUrl)) setRef(fromUrl.toLowerCase());
    }
  }, [params]);

  const info = useQuery({
    queryKey: ["referral", address],
    queryFn: () => api<{ referrer: string | null }>(`/referrals/${address}`),
    enabled: !!address && !!ref,
  });

  if (!address || !ref || ref === address.toLowerCase() || !info.data || info.data.referrer) return null;

  const link = async () => {
    try {
      const signature = await signMessageAsync({ message: referralMessage(ref, address) });
      await api("/referrals", { method: "POST", body: JSON.stringify({ referee: address, referrer: ref, signature }) });
      toast({ kind: "success", title: "Referral tersambung" });
      qc.invalidateQueries({ queryKey: ["referral"] });
    } catch (e) {
      toast({ kind: "error", title: "Referral gagal", body: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <div className="mx-auto mt-3 flex max-w-5xl items-center justify-between gap-3 px-4">
      <div className="flex w-full items-center justify-between gap-3 rounded-2xl border border-up/30 bg-up/10 px-4 py-2.5 text-sm">
        <span>
          Diundang oleh <span className="font-mono">{ref.slice(0, 6)}…{ref.slice(-4)}</span>
        </span>
        <button onClick={link} className="shrink-0 rounded-full bg-up px-3 py-1 text-xs font-semibold text-black">
          Tanda tangani
        </button>
      </div>
    </div>
  );
}

export function ReferralBanner() {
  return (
    <Suspense fallback={null}>
      <Banner />
    </Suspense>
  );
}
