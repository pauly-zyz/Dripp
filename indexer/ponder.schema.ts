import { index, onchainTable, primaryKey } from "ponder";

/**
 * Indexed Dripp state. Amounts are raw on-chain integers:
 * - "raw" stock amounts are Stock Token wei (balanceOf units);
 * - PT/YT amounts are series shares (18 decimals);
 * - multipliers / indexes / ratios have 18 decimals (1e18 = 1.0).
 * Postgres column names are snake_case of the property names.
 */

/** A Stock Token registered in the DividendOracle and/or allowed in the factory. */
export const stockToken = onchainTable("stock_token", (t) => ({
  address: t.hex().primaryKey(),
  ticker: t.text(),
  allowed: t.boolean().notNull().default(false),
  registeredAt: t.bigint(),
  /** uiMultiplier as of the last confirmed oracle proposal. */
  confirmedMultiplier: t.bigint().notNull().default(0n),
  dividendIndex: t.bigint().notNull().default(0n),
  splitFactor: t.bigint().notNull().default(0n),
  pendingProposalId: t.bigint(),
  lastConfirmedAt: t.bigint(),
}));

/** One Dripp series (vault). */
export const series = onchainTable(
  "series",
  (t) => ({
    vault: t.hex().primaryKey(),
    name: t.text().notNull(),
    stockToken: t.hex().notNull(),
    pt: t.hex().notNull(),
    yt: t.hex().notNull(),
    maturity: t.bigint().notNull(),
    depositCap: t.bigint().notNull(),
    createdAt: t.bigint().notNull(),
    createdBlock: t.bigint().notNull(),
    /** Vault index (pyIndexStored): shares per raw token, 18 decimals. */
    index: t.bigint().notNull(),
    indexAtMaturity: t.bigint(),
    /** Raw stock tokens held by the vault. */
    reserves: t.bigint().notNull().default(0n),
    ptSupply: t.bigint().notNull().default(0n),
    ytSupply: t.bigint().notNull().default(0n),
    totalYieldClaimed: t.bigint().notNull().default(0n),
    totalFees: t.bigint().notNull().default(0n),
    paused: t.boolean().notNull().default(false),
  }),
  (table) => ({ stockIdx: index().on(table.stockToken), nameIdx: index().on(table.name) }),
);

/** PT/YT token -> series lookup. */
export const drippToken = onchainTable("dripp_token", (t) => ({
  address: t.hex().primaryKey(),
  vault: t.hex().notNull(),
  kind: t.text().notNull(), // "PT" | "YT"
}));

/** PT/YT balances. Rows stay at balance 0 so accrued YT yield can still be found. */
export const holder = onchainTable(
  "holder",
  (t) => ({
    token: t.hex().notNull(),
    account: t.hex().notNull(),
    vault: t.hex().notNull(),
    kind: t.text().notNull(),
    balance: t.bigint().notNull(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.token, table.account] }),
    accountIdx: index().on(table.account),
    tokenBalanceIdx: index().on(table.token, table.balance),
  }),
);

/** split / merge / redeem / claim, one row per vault event. */
export const vaultAction = onchainTable(
  "vault_action",
  (t) => ({
    id: t.text().primaryKey(),
    vault: t.hex().notNull(),
    kind: t.text().notNull(), // "split" | "merge" | "redeem" | "claim"
    caller: t.hex().notNull(),
    receiver: t.hex().notNull(),
    /** Raw stock tokens in (split) or out (merge / redeem / claim, net of fee). */
    stockAmount: t.bigint().notNull(),
    /** PT/YT minted or burned (0 for claim). */
    pyAmount: t.bigint().notNull(),
    fee: t.bigint().notNull(),
    index: t.bigint(),
    timestamp: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (table) => ({
    vaultIdx: index().on(table.vault, table.timestamp),
    callerIdx: index().on(table.caller),
    receiverIdx: index().on(table.receiver),
  }),
);

/** DividendOracle proposals. */
export const proposal = onchainTable(
  "proposal",
  (t) => ({
    id: t.text().primaryKey(), // `${stockToken}-${proposalId}`
    stockToken: t.hex().notNull(),
    proposalId: t.bigint().notNull(),
    kind: t.text().notNull(), // "dividend" | "split" | "mixed"
    status: t.text().notNull(), // "pending" | "confirmed" | "disputed"
    fromMultiplier: t.bigint().notNull(),
    toMultiplier: t.bigint().notNull(),
    splitRatio: t.bigint().notNull(),
    dividendIndexBefore: t.bigint().notNull(),
    dividendIndexAfter: t.bigint().notNull(),
    proposedAt: t.bigint().notNull(),
    disputeEndsAt: t.bigint().notNull(),
    resolvedAt: t.bigint(),
    proposer: t.hex().notNull(),
    disputer: t.hex(),
    txHash: t.hex().notNull(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({ stockIdx: index().on(table.stockToken, table.proposedAt), statusIdx: index().on(table.status) }),
);

/** ERC-8056 UIMultiplierUpdated announcements: the on-chain ex-dividend / split schedule. */
export const multiplierUpdate = onchainTable(
  "multiplier_update",
  (t) => ({
    id: t.text().primaryKey(),
    stockToken: t.hex().notNull(),
    oldMultiplier: t.bigint().notNull(),
    newMultiplier: t.bigint().notNull(),
    effectiveAt: t.bigint().notNull(),
    announcedAt: t.bigint().notNull(),
    cancelled: t.boolean().notNull().default(false),
    txHash: t.hex().notNull(),
  }),
  (table) => ({ stockIdx: index().on(table.stockToken, table.effectiveAt) }),
);

/** Uniswap v3 pools pairing a PT or YT with its series' stock token. */
export const pool = onchainTable(
  "pool",
  (t) => ({
    address: t.hex().primaryKey(),
    vault: t.hex().notNull(),
    side: t.text().notNull(), // "PT" | "YT"
    token: t.hex().notNull(),
    stockToken: t.hex().notNull(),
    token0: t.hex().notNull(),
    token1: t.hex().notNull(),
    fee: t.integer().notNull(),
    createdAt: t.bigint().notNull(),
    sqrtPriceX96: t.bigint(),
    tick: t.integer(),
    liquidity: t.bigint(),
    lastSwapAt: t.bigint(),
    swapCount: t.integer().notNull().default(0),
    /** Sum of |stock amount| over swaps, raw. */
    volumeStock: t.bigint().notNull().default(0n),
  }),
  (table) => ({ vaultIdx: index().on(table.vault) }),
);

/** Swaps in PT/YT pools. Deltas are from the pool's point of view (+ = pool received). */
export const swap = onchainTable(
  "swap",
  (t) => ({
    id: t.text().primaryKey(), // `${txHash}-${logIndex}`
    pool: t.hex().notNull(),
    vault: t.hex().notNull(),
    side: t.text().notNull(),
    /** Transaction sender: the trader. */
    trader: t.hex().notNull(),
    recipient: t.hex().notNull(),
    tokenDelta: t.bigint().notNull(),
    stockDelta: t.bigint().notNull(),
    sqrtPriceX96: t.bigint().notNull(),
    tick: t.integer().notNull(),
    liquidity: t.bigint().notNull(),
    /** Series index when the swap happened (to value stock amounts in shares). */
    index: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (table) => ({
    vaultIdx: index().on(table.vault, table.timestamp),
    poolIdx: index().on(table.pool, table.timestamp),
    traderIdx: index().on(table.trader),
  }),
);

/** DrippRouter zaps. */
export const zap = onchainTable(
  "zap",
  (t) => ({
    id: t.text().primaryKey(),
    sender: t.hex().notNull(),
    receiver: t.hex().notNull(),
    vault: t.hex().notNull(),
    target: t.text().notNull(), // "PT" | "YT" | "PY"
    tokenIn: t.hex().notNull(),
    amountIn: t.bigint().notNull(),
    fee: t.bigint().notNull(),
    amountOut: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (table) => ({ senderIdx: index().on(table.sender), vaultIdx: index().on(table.vault) }),
);

/** Per trader and series totals for the leaderboard. */
export const traderSeries = onchainTable(
  "trader_series",
  (t) => ({
    account: t.hex().notNull(),
    vault: t.hex().notNull(),
    swapCount: t.integer().notNull().default(0),
    /** Sum of |stock amount| over the trader's PT/YT swaps, raw. */
    swapVolumeStock: t.bigint().notNull().default(0n),
    /** Same volume valued in shares at the swap-time index. */
    swapVolumeShares: t.bigint().notNull().default(0n),
    zapCount: t.integer().notNull().default(0),
    /** Net YT yield claimed, raw stock. */
    yieldClaimed: t.bigint().notNull().default(0n),
    splitAmount: t.bigint().notNull().default(0n),
    lastActiveAt: t.bigint().notNull(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.account, table.vault] }), accountIdx: index().on(table.account) }),
);

/** Factory-wide settings (single row, id = "factory"). */
export const protocol = onchainTable("protocol", (t) => ({
  id: t.text().primaryKey(),
  treasury: t.hex(),
  stockDrip: t.hex(),
  guardian: t.hex(),
  ytFeeBps: t.integer(),
  zapFeeBps: t.integer(),
  stockDripShareBps: t.integer(),
}));
