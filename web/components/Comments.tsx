"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { api, commentMessage, type Comment } from "@/lib/api";
import { shortAddr } from "@/lib/format";
import { useComments } from "@/lib/hooks";
import { useToast } from "./Toast";
import { Button } from "./ui";

const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "baru saja";
  if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  return `${Math.floor(s / 86400)} hari lalu`;
};

/** Per-series discussion; posting needs a connected wallet and a signature (no gas). */
export function Comments({ series }: { series: string }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const list = useComments(series);
  const qc = useQueryClient();
  const toast = useToast();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const post = async () => {
    if (!address || !body.trim()) return;
    setSending(true);
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = await signMessageAsync({ message: commentMessage(series, timestamp, body) });
      const c = await api<Comment>(`/markets/${series}/comments`, {
        method: "POST",
        body: JSON.stringify({ author: address, body, timestamp, signature }),
      });
      qc.setQueryData<{ comments: Comment[] }>(["comments", series.toUpperCase()], (old) => ({
        comments: [c, ...(old?.comments ?? [])],
      }));
      setBody("");
    } catch (e) {
      toast({ kind: "error", title: "Komentar gagal", body: e instanceof Error ? e.message : undefined });
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      {address ? (
        <div className="space-y-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder={`Pendapat Anda soal ${series}?`}
            aria-label="Komentar"
            className="w-full resize-none rounded-2xl border border-line bg-card-2 p-3 text-sm outline-none placeholder:text-muted focus:border-muted"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">{body.length}/500 · ditandatangani wallet, tanpa gas</span>
            <Button onClick={post} disabled={!body.trim()} busy={sending} className="h-9 px-4 text-sm">
              Kirim
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-2xl border border-line px-4 py-3 text-sm text-muted">
          Hubungkan wallet untuk ikut berdiskusi
          <ConnectButton.Custom>
            {({ openConnectModal }) => (
              <button onClick={openConnectModal} className="font-semibold text-up">
                Hubungkan
              </button>
            )}
          </ConnectButton.Custom>
        </div>
      )}
      <ul className="mt-4 divide-y divide-line">
        {list.data?.comments.map((c) => (
          <li key={c.id} className="py-3">
            <p className="text-xs text-muted">
              <span className="font-mono text-fg">{shortAddr(c.author)}</span> · {ago(c.createdAt)}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
          </li>
        ))}
        {list.data && list.data.comments.length === 0 && <li className="py-6 text-center text-sm text-muted">Belum ada komentar.</li>}
      </ul>
    </div>
  );
}
