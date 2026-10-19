import { createConfig, factory } from "ponder";
import { getAbiItem } from "viem";
import {
  DividendOracleAbi,
  DrippRouterAbi,
  DrippVaultAbi,
  DrippVaultFactoryAbi,
  IScaledUIAmountAbi,
  PTTokenAbi,
  YTTokenAbi,
  loadDeployment,
  uniswapV3FactoryAbi,
} from "@dripp/shared";

/**
 * Addresses and the start block come from contracts/deployments/<chainId>.json (DRIPP_DEPLOYMENT),
 * written by contracts/script/Deploy.s.sol.
 */
const d = loadDeployment();
const chain = "robinhood" as const;
const startBlock = d.startBlock;

const seriesCreated = getAbiItem({ abi: DrippVaultFactoryAbi, name: "SeriesCreated" });
const tokenRegistered = getAbiItem({ abi: DividendOracleAbi, name: "TokenRegistered" });

export default createConfig({
  database: process.env.DATABASE_URL
    ? { kind: "postgres", connectionString: process.env.DATABASE_URL }
    : { kind: "pglite" },
  chains: {
    [chain]: {
      id: d.chainId,
      rpc: process.env.PONDER_RPC_URL,
      pollingInterval: Number(process.env.PONDER_POLLING_INTERVAL ?? 1_000),
      cacheRpcRequests: process.env.PONDER_CACHE_RPC !== "false",
    },
  },
  contracts: {
    DrippVaultFactory: { chain, abi: DrippVaultFactoryAbi, address: d.factory, startBlock },
    DrippVault: {
      chain,
      abi: DrippVaultAbi,
      address: factory({ address: d.factory, event: seriesCreated, parameter: "vault" }),
      startBlock,
    },
    PTToken: {
      chain,
      abi: PTTokenAbi,
      address: factory({ address: d.factory, event: seriesCreated, parameter: "pt" }),
      startBlock,
    },
    YTToken: {
      chain,
      abi: YTTokenAbi,
      address: factory({ address: d.factory, event: seriesCreated, parameter: "yt" }),
      startBlock,
    },
    DividendOracle: { chain, abi: DividendOracleAbi, address: d.oracle, startBlock },
    // ERC-8056 multiplier announcements of every Stock Token registered in the oracle.
    StockToken: {
      chain,
      abi: IScaledUIAmountAbi,
      address: factory({ address: d.oracle, event: tokenRegistered, parameter: "stockToken" }),
      startBlock,
    },
    UniswapV3Factory: { chain, abi: uniswapV3FactoryAbi, address: d.uniswap.v3Factory, startBlock },
    DrippRouter: { chain, abi: DrippRouterAbi, address: d.router, startBlock },
  },
});
