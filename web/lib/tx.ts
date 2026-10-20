"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BaseError, ContractFunctionRevertedError, decodeErrorResult, erc20Abi, type Address, type Hash, type Hex, type PublicClient } from "viem";
import { DrippRouterAbi, DrippVaultAbi } from "@dripp/shared/browser";
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

const ERROR_TEXT: Record<string, string> = {
  InsufficientOutput: "Harga bergerak melebihi batas slippage",
  Expired: "Transaksi kedaluwarsa (deadline lewat)",
  DepositCapExceeded: "Batas deposit seri sudah penuh",
  EnforcedPause: "Seri sedang di-pause",
  Matured: "Seri sudah jatuh tempo",
  NotMatured: "Seri belum jatuh tempo",
  UnknownVault: "Seri tidak dikenal",
  BadPath: "Rute swap tidak valid",
};

const ERROR_ABI = [...DrippRouterAbi, ...DrippVaultAbi, ...erc20Abi];

/** Replays a reverted transaction one block earlier to recover a readable revert reason. */
async function revertReason(client: PublicClient, hash: Hash, blockNumber: bigint, gasUsed: bigint): Promise<string> {
  try {
    const tx = await client.getTransaction({ hash });
    if (gasUsed * 100n >= tx.gas * 95n) return "kehabisan gas (coba lagi)";
    await client.call({ account: tx.from, to: tx.to, data: tx.input, value: tx.value, gas: tx.gas, blockNumber: blockNumber - 1n });
    return "tidak diketahui";
  } catch (e) {
    const data = e instanceof BaseError ? ((e.walk((x) => "data" in (x as object)) as { data?: Hex } | null)?.data ?? null) : null;
    if (typeof data === "string" && data.length >= 10) {
      try {
        const { errorName } = decodeErrorResult({ abi: ERROR_ABI, data });
        return ERROR_TEXT[errorName] ?? errorName;
      } catch {
        /* unknown selector */
      }
    }
    if (e instanceof BaseError) {
      const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError);
      if (reverted instanceof ContractFunctionRevertedError && reverted.reason) return reverted.reason;
      return e.shortMessage;
    }
    return String(e);
  }
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
        if (r.status !== "success") {
          throw new Error(`Transaksi gagal: ${await revertReason(client, hash, r.blockNumber, r.gasUsed)} (${hash.slice(0, 10)}…)`);
        }
      };
      // Exact gas estimates can run out of gas in nested calls (63/64 rule: router -> Uniswap -> token
      // callbacks), so every write gets the estimate plus a 25% margin.
      const write = (async (args: Parameters<Write>[0]) => {
        const a = args as unknown as Parameters<typeof client.estimateContractGas>[0];
        const estimate = await client.estimateContractGas({ ...a, account: address });
        return writeContractAsync({ ...args, gas: (estimate * 125n) / 100n } as Parameters<Write>[0]);
      }) as Write;
      const ctx: TxContext = {
        account: address,
        write,
        ensureAllowance: async (token, spender, amount) => {
          const allowance = await client.readContract({
            abi: erc20Abi,
            address: token,
            functionName: "allowance",
            args: [address, spender],
          });
          if (allowance >= amount) return;
          setBusy("Approve");
          await wait(await write({ abi: erc20Abi, address: token, functionName: "approve", args: [spender, amount] }));
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
