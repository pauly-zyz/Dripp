import { ponder } from "ponder:registry";
import { traderSeries, zap } from "ponder:schema";

const TARGETS = ["PT", "YT", "PY"] as const;

ponder.on("DrippRouter:Zapped", async ({ event, context }) => {
  const { sender, receiver, vault, target, tokenIn, amountIn, fee, amountOut } = event.args;
  await context.db.insert(zap).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    sender,
    receiver,
    vault,
    target: TARGETS[target] ?? String(target),
    tokenIn,
    amountIn,
    fee,
    amountOut,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
  await context.db
    .insert(traderSeries)
    .values({ account: sender, vault, zapCount: 1, lastActiveAt: event.block.timestamp })
    .onConflictDoUpdate((r) => ({ zapCount: r.zapCount + 1, lastActiveAt: event.block.timestamp }));
});
