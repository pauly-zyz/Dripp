"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { num, shortAddr } from "@/lib/format";
import { Card, InfoTip } from "./ui";

interface ReferralInfo {
  referrer: string | null;
  referees: { address: string; since: string; points: number }[];
  referralPoints: number;
}

/** The connected wallet's referral link, referees and referral points. */
export function ReferralCard({ address }: { address: string }) {
  const info = useQuery({ queryKey: ["referral-info", address], queryFn: () => api<ReferralInfo>(`/referrals/${address}`) });
  const [copied, setCopied] = useState(false);
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/?ref=${address.toLowerCase()}`;
  return (
    <Card>
      <h2 className="flex items-center font-semibold">
        Referral
        <InfoTip text="Bagikan link ini. Wallet yang terhubung lewat link Anda dan menandatanganinya menjadi referral Anda; Anda mendapat 10% poin mereka." label="Referral" />
      </h2>
      <div className="mt-3 flex items-center gap-2">
        <input readOnly value={link} aria-label="Link referral" className="min-w-0 flex-1 truncate rounded-full bg-card-2 px-3 py-2 font-mono text-xs text-muted" />
        <button
          onClick={() => {
            navigator.clipboard?.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="shrink-0 rounded-full bg-fg px-3 py-2 text-xs font-semibold text-bg"
        >
          {copied ? "Tersalin" : "Salin"}
        </button>
      </div>
      <p className="mt-3 text-sm text-muted">
        {info.data ? `${info.data.referees.length} referral · ${num(info.data.referralPoints, 2)} poin referral` : "…"}
        {info.data?.referrer && <span> · diundang oleh <span className="font-mono">{shortAddr(info.data.referrer)}</span></span>}
      </p>
    </Card>
  );
}
