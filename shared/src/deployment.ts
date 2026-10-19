import { readFileSync } from "node:fs";
import type { Address } from "viem";

/** contracts/deployments/<chainId>.json, written by contracts/script/Deploy.s.sol. */
export interface Deployment {
  chainId: number;
  startBlock: number;
  factory: Address;
  oracle: Address;
  router: Address;
  owner: Address;
  uniswap: { v3Factory: Address; swapRouter: Address; weth: Address; usdg: Address };
  stockTokens: { ticker: string; address: Address; feed: Address }[];
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

/** Loads the deployment file from `path` or the DRIPP_DEPLOYMENT env var. */
export function loadDeployment(path = process.env.DRIPP_DEPLOYMENT): Deployment {
  if (!path) throw new Error("DRIPP_DEPLOYMENT is not set (path to contracts/deployments/<chainId>.json)");
  const d = JSON.parse(readFileSync(path, "utf8")) as Deployment;
  const lower = (a: Address) => a.toLowerCase() as Address;
  return {
    ...d,
    factory: lower(d.factory),
    oracle: lower(d.oracle),
    router: lower(d.router),
    owner: lower(d.owner),
    uniswap: {
      v3Factory: lower(d.uniswap.v3Factory),
      swapRouter: lower(d.uniswap.swapRouter),
      weth: lower(d.uniswap.weth),
      usdg: lower(d.uniswap.usdg),
    },
    stockTokens: d.stockTokens.map((t) => ({ ...t, address: lower(t.address), feed: lower(t.feed) })),
  };
}
