import { ponder } from "ponder:registry";
import { series, traderSeries, vaultAction } from "ponder:schema";

type EventMeta = {
  log: { address: `0x${string}`; logIndex: number };
  block: { timestamp: bigint; number: bigint };
  transaction: { hash: `0x${string}` };
};

function base(e: EventMeta) {
  return {
    id: `${e.transaction.hash}-${e.log.logIndex}`,
    vault: e.log.address,
    timestamp: e.block.timestamp,
    blockNumber: e.block.number,
    txHash: e.transaction.hash,
  };
}

ponder.on("DrippVault:Split", async ({ event, context }) => {
  const { caller, receiver, sharesIn, pyOut, index } = event.args;
  await context.db.insert(vaultAction).values({
    ...base(event),
    kind: "split",
    caller,
    receiver,
    stockAmount: sharesIn,
    pyAmount: pyOut,
    fee: 0n,
    index,
  });
  await context.db.update(series, { vault: event.log.address }).set((s) => ({ reserves: s.reserves + sharesIn }));
  await context.db
    .insert(traderSeries)
    .values({ account: caller, vault: event.log.address, splitAmount: sharesIn, lastActiveAt: event.block.timestamp })
    .onConflictDoUpdate((r) => ({ splitAmount: r.splitAmount + sharesIn, lastActiveAt: event.block.timestamp }));
});

ponder.on("DrippVault:Merge", async ({ event, context }) => {
  const { caller, receiver, pyIn, sharesOut, index } = event.args;
  await context.db.insert(vaultAction).values({
    ...base(event),
    kind: "merge",
    caller,
    receiver,
    stockAmount: sharesOut,
    pyAmount: pyIn,
    fee: 0n,
    index,
  });
  await context.db.update(series, { vault: event.log.address }).set((s) => ({ reserves: s.reserves - sharesOut }));
});

ponder.on("DrippVault:Redeem", async ({ event, context }) => {
  const { caller, receiver, ptIn, sharesOut, index } = event.args;
  await context.db.insert(vaultAction).values({
    ...base(event),
    kind: "redeem",
    caller,
    receiver,
    stockAmount: sharesOut,
    pyAmount: ptIn,
    fee: 0n,
    index,
  });
  await context.db.update(series, { vault: event.log.address }).set((s) => ({ reserves: s.reserves - sharesOut }));
});

ponder.on("DrippVault:PostMaturityYieldToTreasury", async ({ event, context }) => {
  const { shares } = event.args;
  await context.db.update(series, { vault: event.log.address }).set((s) => ({ reserves: s.reserves - shares }));
});

ponder.on("DrippVault:YieldClaimed", async ({ event, context }) => {
  const { user, receiver, sharesOut, fee } = event.args;
  if (sharesOut === 0n && fee === 0n) return;
  await context.db.insert(vaultAction).values({
    ...base(event),
    kind: "claim",
    caller: user,
    receiver,
    stockAmount: sharesOut,
    pyAmount: 0n,
    fee,
    index: null,
  });
  await context.db.update(series, { vault: event.log.address }).set((s) => ({
    reserves: s.reserves - sharesOut - fee,
    totalYieldClaimed: s.totalYieldClaimed + sharesOut,
    totalFees: s.totalFees + fee,
  }));
  await context.db
    .insert(traderSeries)
    .values({ account: user, vault: event.log.address, yieldClaimed: sharesOut, lastActiveAt: event.block.timestamp })
    .onConflictDoUpdate((r) => ({ yieldClaimed: r.yieldClaimed + sharesOut, lastActiveAt: event.block.timestamp }));
});

ponder.on("DrippVault:IndexUpdated", async ({ event, context }) => {
  await context.db.update(series, { vault: event.log.address }).set({ index: event.args.newIndex });
});

ponder.on("DrippVault:MaturityIndexSet", async ({ event, context }) => {
  await context.db.update(series, { vault: event.log.address }).set({ indexAtMaturity: event.args.index });
});

ponder.on("DrippVault:DepositCapUpdated", async ({ event, context }) => {
  await context.db.update(series, { vault: event.log.address }).set({ depositCap: event.args.cap });
});

ponder.on("DrippVault:Paused", async ({ event, context }) => {
  await context.db.update(series, { vault: event.log.address }).set({ paused: true });
});

ponder.on("DrippVault:Unpaused", async ({ event, context }) => {
  await context.db.update(series, { vault: event.log.address }).set({ paused: false });
});
