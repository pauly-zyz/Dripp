import { defineChain, http, type Chain } from "viem";
import { foundry, robinhood, robinhoodTestnet } from "viem/chains";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig } from "wagmi";

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? robinhood.id);
const RPC = process.env.NEXT_PUBLIC_RPC_URL;
const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID;

const local = defineChain({ ...foundry, name: "Local (anvil)" });

/** Robinhood Chain is the default network; testnet and anvil for development. */
export const chain: Chain =
  CHAIN_ID === robinhoodTestnet.id ? robinhoodTestnet : CHAIN_ID === local.id ? local : robinhood;

export const explorer = chain.blockExplorers?.default.url ?? null;
export const txUrl = (hash: string) => (explorer ? `${explorer}/tx/${hash}` : null);
export const addressUrl = (a: string) => (explorer ? `${explorer}/address/${a}` : null);

const connectors = connectorsForWallets(
  [
    {
      groupName: "Wallet",
      wallets: WC_PROJECT_ID
        ? [injectedWallet, metaMaskWallet, rabbyWallet, coinbaseWallet, rainbowWallet, walletConnectWallet]
        : [injectedWallet, rabbyWallet, coinbaseWallet],
    },
  ],
  { appName: "Dripp", projectId: WC_PROJECT_ID ?? "dripp-no-walletconnect" },
);

export const wagmiConfig = createConfig({
  chains: [chain],
  connectors,
  transports: { [chain.id]: http(RPC) },
  ssr: true,
});
