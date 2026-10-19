import { ponder } from "ponder:registry";
import { multiplierUpdate, proposal, stockToken } from "ponder:schema";
import { and, desc, eq } from "ponder";
import { ONE } from "@dripp/shared";

const pid = (token: string, id: bigint) => `${token}-${id}`;

ponder.on("DividendOracle:TokenRegistered", async ({ event, context }) => {
  const { stockToken: address, multiplier } = event.args;
  const values = {
    registeredAt: event.block.timestamp,
    confirmedMultiplier: multiplier,
    dividendIndex: multiplier,
    splitFactor: ONE,
  };
  await context.db
    .insert(stockToken)
    .values({ address, ...values })
    .onConflictDoUpdate(values);
});

ponder.on("DividendOracle:DividendProposed", async ({ event, context }) => {
  const { stockToken: token, id, fromMultiplier, toMultiplier, splitRatio, dividendIndexAfter, disputeEndsAt } =
    event.args;
  const st = await context.db.find(stockToken, { address: token });
  const indexBefore = st?.dividendIndex ?? 0n;
  const kind = splitRatio === ONE ? "dividend" : dividendIndexAfter === indexBefore ? "split" : "mixed";
  await context.db.insert(proposal).values({
    id: pid(token, id),
    stockToken: token,
    proposalId: id,
    kind,
    status: "pending",
    fromMultiplier,
    toMultiplier,
    splitRatio,
    dividendIndexBefore: indexBefore,
    dividendIndexAfter,
    proposedAt: event.block.timestamp,
    disputeEndsAt,
    proposer: event.transaction.from,
    txHash: event.transaction.hash,
    updatedAt: event.block.timestamp,
  });
  await context.db.update(stockToken, { address: token }).set({ pendingProposalId: id });
});

ponder.on("DividendOracle:DividendDisputed", async ({ event, context }) => {
  const { stockToken: token, id, by } = event.args;
  await context.db.update(proposal, { id: pid(token, id) }).set({
    status: "disputed",
    disputer: by,
    resolvedAt: event.block.timestamp,
    updatedAt: event.block.timestamp,
  });
  await context.db.update(stockToken, { address: token }).set({ pendingProposalId: null });
});

ponder.on("DividendOracle:DividendConfirmed", async ({ event, context }) => {
  const { stockToken: token, id, dividendIndex, splitFactor } = event.args;
  const p = await context.db.update(proposal, { id: pid(token, id) }).set({
    status: "confirmed",
    resolvedAt: event.block.timestamp,
    updatedAt: event.block.timestamp,
  });
  await context.db.update(stockToken, { address: token }).set({
    dividendIndex,
    splitFactor,
    confirmedMultiplier: p.toMultiplier,
    pendingProposalId: null,
    lastConfirmedAt: event.block.timestamp,
  });
});

ponder.on("StockToken:UIMultiplierUpdated", async ({ event, context }) => {
  const { oldMultiplier, newMultiplier, effectiveAtTimestamp } = event.args;
  await context.db.insert(multiplierUpdate).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    stockToken: event.log.address,
    oldMultiplier,
    newMultiplier,
    effectiveAt: effectiveAtTimestamp,
    announcedAt: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});

ponder.on("StockToken:UIMultiplierUpdateCancelled", async ({ event, context }) => {
  const { cancelledMultiplier, cancelledEffectiveAt } = event.args;
  const [latest] = await context.db.sql
    .select()
    .from(multiplierUpdate)
    .where(
      and(
        eq(multiplierUpdate.stockToken, event.log.address),
        eq(multiplierUpdate.newMultiplier, cancelledMultiplier),
        eq(multiplierUpdate.effectiveAt, cancelledEffectiveAt),
        eq(multiplierUpdate.cancelled, false),
      ),
    )
    .orderBy(desc(multiplierUpdate.announcedAt))
    .limit(1);
  if (latest) await context.db.update(multiplierUpdate, { id: latest.id }).set({ cancelled: true });
});
