"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { erc20Abi, type Address, type Hash } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { useToast } from "@/components/Toast";
import { chain, txUrl } from "./chain";

type Write = ReturnType<typeof useWriteContract>["writeContractAsync"];

export interface TxContext {
  account: Address;
  write: Write;
  /** Approves `amount` of `token` to `spender` if the allowance is lower. */
  ensureAllowance: (token: Address, spender: Address, amount: bigint) => Promise<void>;
  /** Chain time + `seconds` (local test chains can run ahead of the wall clock). */
  deadline: (seconds?: number) => Promise<bigint>;
}

const shortError = (e: unknown) => {
  const m = e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e);
  if (/user rejected|denied/i.test(m)) return "Dibatalkan di wallet";
  return m.split("\n")[0]!.slice(0, 160);
};

/** Runs a flow of transactions with network switch, approvals, receipts, toasts and data refresh. */
export function useTx() {
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: chain.id });
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(label: string, flow: (ctx: TxContext) => Promise<Hash>) {
    if (!address || !client) {
      toast({ kind: "error", title: "Hubungkan wallet dulu" });
      return;
    }
    setBusy(label);
    try {
      if (chainId !== chain.id) await switchChainAsync({ chainId: chain.id });
      const wait = async (hash: Hash) => {
        const r = await client.waitForTransactionReceipt({ hash });
        if (r.status !== "success") throw new Error(`Transaksi gagal (${hash})`);
      };
      const ctx: TxContext = {
        account: address,
        write: writeContractAsync,
        ensureAllowance: async (token, spender, amount) => {
          const allowance = await client.readContract({
            abi: erc20Abi,
            address: token,
            functionName: "allowance",
            args: [address, spender],
          });
          if (allowance >= amount) return;
          setBusy("Approve");
          await wait(await writeContractAsync({ abi: erc20Abi, address: token, functionName: "approve", args: [spender, amount] }));
          setBusy(label);
        },
        deadline: async (seconds = 1200) => (await client.getBlock()).timestamp + BigInt(seconds),
      };
      const hash = await flow(ctx);
      await wait(hash);
      toast({ kind: "success", title: `${label} berhasil`, href: txUrl(hash) });
      await qc.invalidateQueries();
      return hash;
    } catch (e) {
      toast({ kind: "error", title: `${label} gagal`, body: shortError(e) });
    } finally {
      setBusy(null);
    }
  }

  return { run, busy, connected: !!address, account: address };
}
