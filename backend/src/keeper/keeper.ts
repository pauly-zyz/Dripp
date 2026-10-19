import type { Account, Address, Chain, Hash, PublicClient, Transport, WalletClient } from "viem";
import {
  DividendOracleAbi,
  IScaledUIAmountAbi,
  classifyMultiplierChange,
  type AnnouncedAction,
  type Classification,
} from "@dripp/shared";

/**
 * DividendOracle keeper (SPEC: "Memantau uiMultiplier() tiap Stock Token dan mengusulkan dividen/split").
 * Per registered stock token, each run:
 *  1. pending proposal whose 24h dispute window is over -> confirm();
 *  2. else, uiMultiplier differs from the last confirmed one -> classify and propose:
 *       dividend -> proposeDividend, split -> proposeSplit, mixed -> propose(token, splitRatio);
 *     an ambiguous change is not proposed; it raises an alert for the multisig.
 * Without a wallet the keeper runs dry: it reports what it would send.
 */
export type KeeperAction =
  | { type: "confirm"; token: Address; proposalId: bigint; tx?: Hash }
  | { type: "propose"; token: Address; kind: "dividend" | "split" | "mixed"; splitRatio?: bigint; from: bigint; to: bigint; tx?: Hash }
  | { type: "wait"; token: Address; proposalId: bigint; secondsLeft: number }
  | { type: "ambiguous"; token: Address; from: bigint; to: bigint; reason: string }
  | { type: "idle"; token: Address }
  | { type: "error"; token: Address; error: string };

export interface Announcement {
  id: number;
  action: AnnouncedAction;
}

export interface KeeperDeps {
  client: PublicClient;
  wallet?: WalletClient<Transport, Chain | undefined, Account>;
  oracle: Address;
  /** Matching team announcement for `token` around `now`, if any. */
  findAnnouncement?: (token: Address, now: number) => Promise<Announcement | null>;
  markAnnouncementUsed?: (id: number, tx: Hash | "dry-run") => Promise<void>;
  alert?: (text: string) => Promise<void>;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

export async function runKeeperOnce(deps: KeeperDeps, tokens: Address[]): Promise<KeeperAction[]> {
  const block = await deps.client.getBlock({ blockTag: "latest" });
  const now = Number(block.timestamp);
  const actions: KeeperAction[] = [];
  for (const token of tokens) {
    try {
      actions.push(await handleToken(deps, token, now));
    } catch (e) {
      const error = e instanceof Error ? e.message.split("\n")[0]! : String(e);
      deps.log?.("keeper error", { token, error });
      actions.push({ type: "error", token, error });
    }
  }
  return actions;
}

async function handleToken(deps: KeeperDeps, token: Address, now: number): Promise<KeeperAction> {
  const { client, oracle } = deps;
  const o = { abi: DividendOracleAbi, address: oracle } as const;
  if (!(await client.readContract({ ...o, functionName: "isRegistered", args: [token] }))) {
    return { type: "error", token, error: "not registered in oracle" };
  }

  const [pending, id] = await client.readContract({ ...o, functionName: "pendingProposal", args: [token] });
  if (pending) {
    const p = await client.readContract({
      abi: DividendOracleAbi,
      address: oracle,
      functionName: "getProposal",
      args: [token, id],
    });
    const endsAt = Number(p.disputeEndsAt);
    if (now < endsAt) return { type: "wait", token, proposalId: id, secondsLeft: endsAt - now };
    const tx = await send(deps, "confirm", [token]);
    deps.log?.("confirmed", { token, proposalId: id, tx });
    return { type: "confirm", token, proposalId: id, tx };
  }

  if (!(await client.readContract({ ...o, functionName: "needsProposal", args: [token] }))) {
    return { type: "idle", token };
  }

  const [from, to] = await Promise.all([
    client.readContract({ ...o, functionName: "confirmedMultiplier", args: [token] }),
    client.readContract({ abi: IScaledUIAmountAbi, address: token, functionName: "uiMultiplier" }),
  ]);
  const announcement = (await deps.findAnnouncement?.(token, now)) ?? null;
  const c: Classification = classifyMultiplierChange(from, to, { announced: announcement?.action });

  if (c.kind === "ambiguous") {
    const text = `Dripp keeper: uiMultiplier of ${token} moved ${from} -> ${to} and could not be classified (${c.reason}). Propose it from the multisig.`;
    deps.log?.("ambiguous", { token, from, to, reason: c.reason });
    await deps.alert?.(text);
    return { type: "ambiguous", token, from, to, reason: c.reason };
  }

  const tx =
    c.kind === "dividend"
      ? await send(deps, "proposeDividend", [token])
      : c.kind === "split"
        ? await send(deps, "proposeSplit", [token])
        : await send(deps, "propose", [token, c.splitRatio]);
  if (announcement) await deps.markAnnouncementUsed?.(announcement.id, tx ?? "dry-run");
  deps.log?.("proposed", { token, kind: c.kind, from, to, tx });
  return {
    type: "propose",
    token,
    kind: c.kind,
    splitRatio: c.kind === "mixed" ? c.splitRatio : undefined,
    from,
    to,
    tx,
  };
}

type WriteFn = "confirm" | "proposeDividend" | "proposeSplit" | "propose";

/** Simulates then sends; returns undefined in dry-run mode (no wallet). */
async function send(deps: KeeperDeps, functionName: WriteFn, args: readonly unknown[]): Promise<Hash | undefined> {
  if (!deps.wallet) return undefined;
  const { request } = await deps.client.simulateContract({
    account: deps.wallet.account,
    address: deps.oracle,
    abi: DividendOracleAbi,
    functionName,
    args: args as never,
  });
  const hash = await deps.wallet.writeContract(request as never);
  const receipt = await deps.client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
  return hash;
}
