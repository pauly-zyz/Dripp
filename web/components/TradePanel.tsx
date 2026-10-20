"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useMemo, useState } from "react";
import { erc20Abi, formatUnits, parseUnits, zeroAddress, type Address } from "viem";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import { DrippRouterAbi, DrippVaultAbi, swapRouter02Abi, swapRouterV1Abi } from "@dripp/shared/browser";
import type { BuyQuote, Market, QuoteToken, SellQuote } from "@/lib/api";
import { chain } from "@/lib/chain";
import { EDU } from "@/lib/edu";
import { dateShort, num, wad } from "@/lib/format";
import { useProtocol, useQuote } from "@/lib/hooks";
import { useTx } from "@/lib/tx";
import { Button, InfoTip, Segmented } from "./ui";

export type TradeMode = "buy" | "sell" | "split" | "merge" | "redeem";
type Asset = "PT" | "YT" | "PY";

const SLIPPAGES = [50, 100, 200];

function AmountField({
  value,
  onChange,
  token,
  tokens,
  onToken,
  balance,
  decimals,
}: {
  value: string;
  onChange: (v: string) => void;
  token: string;
  tokens?: string[];
  onToken?: (t: string) => void;
  balance: bigint | undefined;
  decimals: number;
}) {
  return (
    <div className="rounded-2xl bg-card-2 p-3">
      <div className="flex items-center gap-2">
        <input
          inputMode="decimal"
          placeholder="0"
          aria-label="Jumlah"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(",", ".").replace(/[^0-9.]/g, ""))}
          className="min-w-0 flex-1 bg-transparent text-3xl font-semibold tabular-nums outline-none placeholder:text-muted"
        />
        {tokens && onToken ? (
          <select
            aria-label="Token"
            value={token}
            onChange={(e) => onToken(e.target.value)}
            className="rounded-full border border-line bg-card px-3 py-1.5 text-sm font-semibold"
          >
            {tokens.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        ) : (
          <span className="rounded-full border border-line bg-card px-3 py-1.5 text-sm font-semibold">{token}</span>
        )}
      </div>
      {balance !== undefined && (
        <button
          type="button"
          onClick={() => onChange(formatUnits(balance, decimals))}
          className="mt-1 text-xs text-muted hover:text-fg"
        >
          Saldo: {num(Number(formatUnits(balance, decimals)), 4)} <span className="text-up">Maks</span>
        </button>
      )}
    </div>
  );
}

function Row({ label, value, tip }: { label: string; value: string; tip?: string }) {
  return (
    <div className="flex justify-between py-1 text-sm">
      <span className="flex items-center text-muted">
        {label}
        {tip && <InfoTip text={tip} label={label} />}
      </span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

const safeParse = (v: string, decimals: number) => {
  try {
    return v && Number(v) > 0 ? parseUnits(v, decimals) : 0n;
  } catch {
    return 0n;
  }
};

export function TradePanel({
  market,
  modes = ["buy", "sell", "split", "merge", "redeem"],
  initialMode = "buy",
  lockAsset,
}: {
  market: Market;
  modes?: TradeMode[];
  initialMode?: TradeMode;
  lockAsset?: Asset;
}) {
  const { address } = useAccount();
  const protocol = useProtocol();
  const { run, busy } = useTx();
  const [mode, setMode] = useState<TradeMode>(initialMode);
  const [asset, setAsset] = useState<Asset>(lockAsset ?? "PT");
  const [token, setToken] = useState<QuoteToken>("ETH");
  const [sellTo, setSellTo] = useState<"STOCK" | "USDG">("STOCK");
  const [amountStr, setAmountStr] = useState("");
  const [slippage, setSlippage] = useState(50);
  const ticker = market.stock.ticker ?? "STOCK";
  const matured = market.status === "matured";
  const index = BigInt(market.index);

  const usdg = protocol.data?.uniswap.usdg;
  const tokenAddr = (t: QuoteToken): Address | undefined => (t === "USDG" ? usdg : t === "STOCK" ? market.stock.address : undefined);
  const decimalsOf = (t: QuoteToken) => (t === "USDG" ? 6 : 18);

  const eth = useBalance({ address, chainId: chain.id, query: { enabled: !!address } });
  const balances = useReadContracts({
    contracts: [market.stock.address, market.pt, market.yt, usdg ?? zeroAddress].map((t) => ({
      address: t,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [address ?? zeroAddress] as const,
      chainId: chain.id,
    })),
    query: { enabled: !!address && !!usdg, refetchInterval: 15_000 },
  });
  const bal = (i: number) => (balances.data?.[i]?.result as bigint | undefined) ?? undefined;
  const balStock = bal(0);
  const balPT = bal(1);
  const balYT = bal(2);
  const balUSDG = bal(3);

  // input token + decimals for the current mode
  const input = useMemo(() => {
    switch (mode) {
      case "buy":
        return { label: token === "STOCK" ? ticker : token, decimals: decimalsOf(token), balance: token === "ETH" ? eth.data?.value : token === "USDG" ? balUSDG : balStock };
      case "sell":
        return { label: asset, decimals: 18, balance: asset === "YT" ? balYT : balPT };
      case "split":
        return { label: ticker, decimals: 18, balance: balStock };
      case "merge":
        return { label: "PT + YT", decimals: 18, balance: balPT !== undefined && balYT !== undefined ? (balPT < balYT ? balPT : balYT) : undefined };
      case "redeem":
        return { label: "PT", decimals: 18, balance: balPT };
    }
  }, [mode, token, asset, ticker, eth.data?.value, balUSDG, balStock, balPT, balYT]);

  const amount = safeParse(amountStr, input.decimals);
  const quoteAsset: Asset = mode === "sell" ? (asset === "PY" ? "PT" : asset) : asset;
  const quote = useQuote(
    mode === "buy" || mode === "sell"
      ? {
          series: market.series,
          side: mode,
          asset: quoteAsset,
          token: mode === "buy" ? token : sellTo,
          amount,
          slippageBps: slippage,
        }
      : null,
  );
  const q = quote.data && quote.data.params.amountIn === amount.toString() ? quote.data : undefined;
  const insufficient = input.balance !== undefined && amount > input.balance;

  const execute = () => {
    if (!address) return;
    if (mode === "buy" && q?.side === "buy") {
      const b = q as BuyQuote;
      return run(`Beli ${b.asset === "PY" ? "PT + YT" : b.asset}`, async ({ write, ensureAllowance, deadline }) => {
        if (b.approve) await ensureAllowance(b.approve.token, b.approve.spender, BigInt(b.approve.amount));
        return write({
          address: b.to,
          abi: DrippRouterAbi,
          functionName: "zap",
          args: [
            {
              vault: b.params.vault,
              target: b.params.target,
              tokenIn: b.params.tokenIn,
              amountIn: BigInt(b.params.amountIn),
              path: b.params.path,
              minOut: BigInt(b.params.minOut),
              receiver: address,
              deadline: await deadline(),
            },
          ],
          value: BigInt(b.value),
        });
      });
    }
    if (mode === "sell" && q?.side === "sell") {
      const s = q as SellQuote;
      return run(`Jual ${s.asset}`, async ({ write, ensureAllowance, deadline }) => {
        await ensureAllowance(s.approve.token, s.approve.spender, BigInt(s.approve.amount));
        const base = { path: s.params.path, recipient: address, amountIn: BigInt(s.params.amountIn), amountOutMinimum: BigInt(s.params.minOut) };
        return s.legacyRouter
          ? write({ address: s.to, abi: swapRouterV1Abi, functionName: "exactInput", args: [{ ...base, deadline: await deadline() }] })
          : write({ address: s.to, abi: swapRouter02Abi, functionName: "exactInput", args: [base] });
      });
    }
    if (mode === "split") {
      return run("Split", async ({ write, ensureAllowance }) => {
        await ensureAllowance(market.stock.address, market.vault, amount);
        return write({ address: market.vault, abi: DrippVaultAbi, functionName: "split", args: [amount, address] });
      });
    }
    if (mode === "merge") {
      return run("Merge", ({ write }) => write({ address: market.vault, abi: DrippVaultAbi, functionName: "merge", args: [amount, address] }));
    }
    if (mode === "redeem") {
      return run("Tebus PT", ({ write }) =>
        write({ address: market.vault, abi: DrippVaultAbi, functionName: "redeemPT", args: [amount, address] }),
      );
    }
  };

  // output preview
  let out: { label: string; value: string } | null = null;
  if ((mode === "buy" || mode === "sell") && q) {
    const outDecimals = mode === "sell" && sellTo === "USDG" ? 6 : 18;
    const outLabel = mode === "buy" ? (asset === "PY" ? "PT dan YT (masing-masing)" : asset) : sellTo === "STOCK" ? ticker : "USDG";
    out = { label: outLabel, value: num(Number(formatUnits(BigInt(q.amountOut), outDecimals)), 4) };
  } else if (mode === "split" && amount > 0n) {
    out = { label: "PT dan YT (masing-masing)", value: num(wad((amount * index) / 10n ** 18n), 4) };
  } else if ((mode === "merge" || mode === "redeem") && amount > 0n) {
    out = { label: ticker, value: num(wad((amount * 10n ** 18n) / index), 4) };
  }

  const needsQuote = mode === "buy" || mode === "sell";
  const disabledReason = !address
    ? null
    : market.paused
      ? "Seri sedang di-pause"
      : amount === 0n
        ? "Masukkan jumlah"
        : insufficient
          ? "Saldo tidak cukup"
          : (mode === "buy" || mode === "split") && matured
            ? "Seri sudah jatuh tempo"
            : mode === "redeem" && !matured
              ? `Bisa ditebus mulai ${dateShort(market.maturityDate)}`
              : needsQuote && quote.isError
                ? "Tidak ada rute/likuiditas"
                : needsQuote && !q
                  ? "Menghitung harga…"
                  : null;

  const labels: Record<TradeMode, string> = { buy: "Beli", sell: "Jual", split: "Split", merge: "Merge", redeem: "Tebus" };
  const actionLabel =
    mode === "buy" ? `Beli ${asset === "PY" ? "PT + YT" : asset}` : mode === "sell" ? `Jual ${asset}` : labels[mode];

  return (
    <div className="space-y-3">
      {modes.length > 1 && (
        <div className="-mx-1 overflow-x-auto px-1">
          <Segmented options={modes.map((m) => ({ value: m, label: labels[m] }))} value={mode} onChange={(m) => { setMode(m); setAmountStr(""); }} size="sm" />
        </div>
      )}

      {(mode === "buy" || mode === "sell") && !lockAsset && (
        <div className="flex items-center gap-2">
          <Segmented
            options={(mode === "buy" ? (["PT", "YT", "PY"] as Asset[]) : (["PT", "YT"] as Asset[])).map((a) => ({
              value: a,
              label: a === "PY" ? "PT+YT" : a,
            }))}
            value={mode === "sell" && asset === "PY" ? "PT" : asset}
            onChange={setAsset}
            size="sm"
          />
          <InfoTip text={asset === "YT" ? EDU.yt : asset === "PY" ? EDU.ptPlusYt : EDU.pt} label="Tentang aset" />
        </div>
      )}

      <AmountField
        value={amountStr}
        onChange={setAmountStr}
        token={mode === "buy" ? token : input.label}
        tokens={mode === "buy" ? ["ETH", "USDG", "STOCK"] : undefined}
        onToken={(t) => {
          setToken(t as QuoteToken);
          setAmountStr("");
        }}
        balance={input.balance}
        decimals={input.decimals}
      />

      {mode === "sell" && (
        <div className="flex items-center gap-2 text-sm text-muted">
          Terima dalam
          <Segmented options={[{ value: "STOCK", label: ticker }, { value: "USDG", label: "USDG" }]} value={sellTo} onChange={(v) => setSellTo(v as "STOCK" | "USDG")} size="sm" />
        </div>
      )}

      <div className="rounded-2xl border border-line px-3 py-2">
        <Row label="Anda menerima ≈" value={out ? `${out.value} ${out.label}` : "—"} />
        {mode === "buy" && asset === "PT" && q && (
          <Row
            label={`Ditebus ${dateShort(market.maturityDate)}`}
            value={`${num(wad(q.amountOut), 4)} saham ${ticker}`}
            tip={EDU.pt}
          />
        )}
        {needsQuote && q && <Row label="Minimal diterima" value={num(Number(formatUnits(BigInt(q.minOut), mode === "sell" && sellTo === "USDG" ? 6 : 18)), 4)} tip={EDU.slippage} />}
        {mode === "buy" && q && <Row label="Fee zap (0,1%)" value={`${num(Number(formatUnits(BigInt((q as BuyQuote).fee), decimalsOf(token))), 6)} ${token === "STOCK" ? ticker : token}`} />}
        {needsQuote && (
          <div className="flex items-center justify-between py-1 text-sm">
            <span className="flex items-center text-muted">
              Slippage
              <InfoTip text={EDU.slippage} label="Slippage" />
            </span>
            <span className="flex gap-1">
              {SLIPPAGES.map((s) => (
                <button
                  key={s}
                  onClick={() => setSlippage(s)}
                  className={`rounded-full px-2 py-0.5 text-xs ${slippage === s ? "bg-fg text-bg" : "bg-card-2 text-muted"}`}
                >
                  {s / 100}%
                </button>
              ))}
            </span>
          </div>
        )}
        {mode === "split" && <p className="py-1 text-xs text-muted">{EDU.split}</p>}
        {mode === "merge" && <p className="py-1 text-xs text-muted">{EDU.merge}</p>}
        {mode === "redeem" && <p className="py-1 text-xs text-muted">{EDU.redeem}</p>}
      </div>

      {!address ? (
        <ConnectButton.Custom>
          {({ openConnectModal }) => (
            <Button onClick={openConnectModal} className="w-full">
              Hubungkan wallet
            </Button>
          )}
        </ConnectButton.Custom>
      ) : (
        <Button onClick={execute} disabled={!!disabledReason} busy={!!busy} className="w-full">
          {disabledReason ?? actionLabel}
        </Button>
      )}
    </div>
  );
}
