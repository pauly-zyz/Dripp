import { ponder } from "ponder:registry";
import { drippToken, protocol, series, stockToken } from "ponder:schema";
import { DrippVaultAbi } from "@dripp/shared";

ponder.on("DrippVaultFactory:SeriesCreated", async ({ event, context }) => {
  const { stockToken: stock, maturity, vault, pt, yt, series: name, depositCap } = event.args;
  const index = await context.client.readContract({
    abi: DrippVaultAbi,
    address: vault,
    functionName: "pyIndexStored",
    blockNumber: event.block.number,
  });
  await context.db.insert(series).values({
    vault,
    name,
    stockToken: stock,
    pt,
    yt,
    maturity,
    depositCap,
    createdAt: event.block.timestamp,
    createdBlock: event.block.number,
    index,
  });
  await context.db.insert(drippToken).values([
    { address: pt, vault, kind: "PT" },
    { address: yt, vault, kind: "YT" },
  ]);
});

ponder.on("DrippVaultFactory:StockTokenAllowed", async ({ event, context }) => {
  const { stockToken: address, allowed, ticker } = event.args;
  await context.db
    .insert(stockToken)
    .values({ address, allowed, ticker })
    .onConflictDoUpdate({ allowed, ticker });
});

ponder.on("DrippVaultFactory:FeesUpdated", async ({ event, context }) => {
  const { ytFeeBps, zapFeeBps, stockDripShareBps } = event.args;
  await context.db
    .insert(protocol)
    .values({ id: "factory", ytFeeBps, zapFeeBps, stockDripShareBps })
    .onConflictDoUpdate({ ytFeeBps, zapFeeBps, stockDripShareBps });
});

ponder.on("DrippVaultFactory:TreasuryUpdated", async ({ event, context }) => {
  const { treasury } = event.args;
  await context.db.insert(protocol).values({ id: "factory", treasury }).onConflictDoUpdate({ treasury });
});

ponder.on("DrippVaultFactory:StockDripUpdated", async ({ event, context }) => {
  const { stockDrip } = event.args;
  await context.db.insert(protocol).values({ id: "factory", stockDrip }).onConflictDoUpdate({ stockDrip });
});

ponder.on("DrippVaultFactory:GuardianUpdated", async ({ event, context }) => {
  const { guardian } = event.args;
  await context.db.insert(protocol).values({ id: "factory", guardian }).onConflictDoUpdate({ guardian });
});
