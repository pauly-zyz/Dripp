import { createPublicClient, erc20Abi, http, type Address, type PublicClient } from "viem";
import {
  DividendOracleAbi,
  DrippVaultAbi,
  IScaledUIAmountAbi,
  ZERO_ADDRESS,
  chainlinkAggregatorAbi,
  uniswapV3PoolAbi,
} from "@dripp/shared";

export function createChainClient(rpcUrl: string): PublicClient {
  return createPublicClient({ transport: http(rpcUrl, { batch: { batchSize: 100, wait: 5 } }) }) as PublicClient;
}

/** Thin, typed on-chain reads used by the API. Calls are JSON-RPC batched by the transport. */
export class ChainReader {
  constructor(readonly client: PublicClient) {}

  async blockTimestamp(): Promise<number> {
    const b = await this.client.getBlock({ blockTag: "latest" });
    return Number(b.timestamp);
  }

  currentIndex(vault: Address) {
    return this.client.readContract({ abi: DrippVaultAbi, address: vault, functionName: "currentIndex" });
  }

  uiMultiplier(stock: Address) {
    return this.client.readContract({ abi: IScaledUIAmountAbi, address: stock, functionName: "uiMultiplier" });
  }

  claimableYield(vault: Address, user: Address) {
    return this.client.readContract({
      abi: DrippVaultAbi,
      address: vault,
      functionName: "claimableYield",
      args: [user],
    });
  }

  balanceOf(token: Address, account: Address) {
    return this.client.readContract({ abi: erc20Abi, address: token, functionName: "balanceOf", args: [account] });
  }

  async slot0(pool: Address) {
    const [sqrtPriceX96, tick] = await this.client.readContract({
      abi: uniswapV3PoolAbi,
      address: pool,
      functionName: "slot0",
    });
    return { sqrtPriceX96, tick };
  }

  pendingProposal(oracle: Address, stock: Address) {
    return this.client.readContract({
      abi: DividendOracleAbi,
      address: oracle,
      functionName: "pendingProposal",
      args: [stock],
    });
  }

  /** USD per stock share from a Chainlink feed, or null when no feed is configured or it fails. */
  async feedPriceUsd(feed: Address): Promise<number | null> {
    if (!feed || feed === ZERO_ADDRESS) return null;
    try {
      const [[, answer], decimals] = await Promise.all([
        this.client.readContract({ abi: chainlinkAggregatorAbi, address: feed, functionName: "latestRoundData" }),
        this.client.readContract({ abi: chainlinkAggregatorAbi, address: feed, functionName: "decimals" }),
      ]);
      return Number(answer) / 10 ** decimals;
    } catch {
      return null;
    }
  }
}
