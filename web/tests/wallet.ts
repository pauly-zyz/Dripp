import type { Page } from "@playwright/test";

/**
 * Minimal EIP-1193 provider injected as window.ethereum: forwards every request to the local anvil
 * node, whose dev accounts are unlocked (eth_sendTransaction and personal_sign are signed by anvil).
 */
export async function injectWallet(page: Page, account: string, rpc = process.env.RPC_URL ?? "http://127.0.0.1:8545") {
  await page.addInitScript(
    ({ account, rpc }) => {
      let id = 1;
      // Like a real wallet, the site permission survives page loads.
      const KEY = "mock-wallet-authorized";
      let authorized = localStorage.getItem(KEY) === "1";
      const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
      const call = async (method: string, params: unknown[] = []) => {
        const r = await fetch(rpc, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }),
        });
        const j = await r.json();
        if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
        return j.result;
      };
      const provider = {
        isMetaMask: false,
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          switch (method) {
            // Like a real wallet: no accounts until the site asked for permission.
            case "eth_requestAccounts":
              authorized = true;
              localStorage.setItem(KEY, "1");
              (listeners.accountsChanged ?? []).forEach((fn) => fn([account]));
              return [account];
            case "eth_accounts":
              return authorized ? [account] : [];
            case "wallet_switchEthereumChain":
            case "wallet_addEthereumChain":
              return null;
            case "wallet_requestPermissions":
            case "wallet_getPermissions":
              return [{ parentCapability: "eth_accounts" }];
            default:
              return call(method, params ?? []);
          }
        },
        on: (e: string, fn: (...a: unknown[]) => void) => {
          (listeners[e] ??= []).push(fn);
        },
        removeListener: (e: string, fn: (...a: unknown[]) => void) => {
          listeners[e] = (listeners[e] ?? []).filter((f) => f !== fn);
        },
      };
      Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    },
    { account, rpc },
  );
}

export const ALICE = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
export const BOB = "0x976EA74026E726554dB657fA54763abd0C3a0aa9";
export const DAVE = "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f"; // anvil #8, fresh account for UI buys

/** Opens the RainbowKit modal, picks the injected wallet and waits until the header shows the account. */
export async function connect(page: Page) {
  await page.getByTestId("rk-connect-button").first().click();
  await page.getByRole("dialog").getByText(/browser wallet|injected/i).first().click();
  await page.getByTestId("rk-account-button").waitFor();
}
