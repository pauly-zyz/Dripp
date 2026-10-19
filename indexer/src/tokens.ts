import { ponder } from "ponder:registry";
import { drippToken, holder, pool, series, swap, traderSeries } from "ponder:schema";
import { decodeEventLog, encodeEventTopics, zeroAddress, type Address } from "viem";
import { ONE, uniswapV3PoolAbi } from "@dripp/shared";

type Ctx = Parameters<Parameters<typeof ponder.on<"PTToken:Transfer">>[1]>[0];

const SWAP_TOPIC = encodeEventTopics({ abi: uniswapV3PoolAbi, eventName: "Swap" })[0];

ponder.on("PTToken:Transfer", async ({ event, context }) => handleTransfer("PT", event, context));
ponder.on("YTToken:Transfer", async ({ event, context }) => handleTransfer("YT", event, context));

async function handleTransfer(kind: "PT" | "YT", event: Ctx["event"], context: Ctx["context"]) {
  const { from, to, value } = event.args;
  const token = event.log.address;
  const ts = event.block.timestamp;
  const meta = await context.db.find(drippToken, { address: token });
  if (!meta) return;
  const vault = meta.vault;

  if (from === zeroAddress || to === zeroAddress) {
    const delta = from === zeroAddress ? value : -value;
    await context.db
      .update(series, { vault })
      .set((s) => (kind === "PT" ? { ptSupply: s.ptSupply + delta } : { ytSupply: s.ytSupply + delta }));
  }
  if (from !== zeroAddress) {
    await context.db
      .insert(holder)
      .values({ token, account: from, vault, kind, balance: -value, updatedAt: ts })
      .onConflictDoUpdate((h) => ({ balance: h.balance - value, updatedAt: ts }));
  }
  if (to !== zeroAddress) {
    await context.db
      .insert(holder)
      .values({ token, account: to, vault, kind, balance: value, updatedAt: ts })
      .onConflictDoUpdate((h) => ({ balance: h.balance + value, updatedAt: ts }));
  }

  // A transfer into or out of a known PT/YT pool: record that pool's Swap logs in this transaction.
  for (const counterparty of [from, to]) {
    if (counterparty === zeroAddress) continue;
    const p = await context.db.find(pool, { address: counterparty });
    if (p) await recordSwaps(p, event, context);
  }
}

async function recordSwaps(p: typeof pool.$inferSelect, event: Ctx["event"], context: Ctx["context"]) {
  const receipt = await context.client.getTransactionReceipt({ hash: event.transaction.hash });
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== p.address || log.topics[0] !== SWAP_TOPIC) continue;
    const { args } = decodeEventLog({ abi: uniswapV3PoolAbi, eventName: "Swap", data: log.data, topics: log.topics });
    const tokenIs0 = p.token === p.token0;
    const tokenDelta = tokenIs0 ? args.amount0 : args.amount1;
    const stockDelta = tokenIs0 ? args.amount1 : args.amount0;
    const s = await context.db.find(series, { vault: p.vault });
    const index = s?.index ?? ONE;
    const trader = event.transaction.from as Address;
    const ts = event.block.timestamp;

    const inserted = await context.db
      .insert(swap)
      .values({
        id: `${event.transaction.hash}-${log.logIndex}`,
        pool: p.address,
        vault: p.vault,
        side: p.side,
        trader,
        recipient: args.recipient.toLowerCase() as Address,
        tokenDelta,
        stockDelta,
        sqrtPriceX96: args.sqrtPriceX96,
        tick: args.tick,
        liquidity: args.liquidity,
        index,
        timestamp: ts,
        blockNumber: event.block.number,
        txHash: event.transaction.hash,
      })
      .onConflictDoNothing();
    if (!inserted) continue; // already recorded from another transfer in the same tx

    const absStock = stockDelta < 0n ? -stockDelta : stockDelta;
    const volumeShares = (absStock * index) / ONE;
    await context.db.update(pool, { address: p.address }).set((row) => ({
      sqrtPriceX96: args.sqrtPriceX96,
      tick: args.tick,
      liquidity: args.liquidity,
      lastSwapAt: ts,
      swapCount: row.swapCount + 1,
      volumeStock: row.volumeStock + absStock,
    }));
    await context.db
      .insert(traderSeries)
      .values({
        account: trader,
        vault: p.vault,
        swapCount: 1,
        swapVolumeStock: absStock,
        swapVolumeShares: volumeShares,
        lastActiveAt: ts,
      })
      .onConflictDoUpdate((r) => ({
        swapCount: r.swapCount + 1,
        swapVolumeStock: r.swapVolumeStock + absStock,
        swapVolumeShares: r.swapVolumeShares + volumeShares,
        lastActiveAt: ts,
      }));
  }
}

/** Keep only pools that pair a PT or YT with its own series' stock token. */
ponder.on("UniswapV3Factory:PoolCreated", async ({ event, context }) => {
  const { token0, token1, fee, pool: address } = event.args;
  for (const [token, other] of [
    [token0, token1],
    [token1, token0],
  ] as const) {
    const meta = await context.db.find(drippToken, { address: token });
    if (!meta) continue;
    const s = await context.db.find(series, { vault: meta.vault });
    if (!s || s.stockToken !== other) continue;
    await context.db.insert(pool).values({
      address,
      vault: meta.vault,
      side: meta.kind,
      token,
      stockToken: other,
      token0,
      token1,
      fee,
      createdAt: event.block.timestamp,
    });
    return;
  }
});
