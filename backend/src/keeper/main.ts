import { createWalletClient, http, type Address, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { and, desc, gte, isNull, isNotNull, lte, eq } from "drizzle-orm";
import { loadDeployment } from "@dripp/shared";
import { createChainClient } from "../chain.ts";
import { app, createDb, ponder } from "../db.ts";
import { runKeeperOnce, type Announcement } from "./keeper.ts";

/**
 * Keeper process.
 *   RPC_URL, DRIPP_DEPLOYMENT        required
 *   KEEPER_PRIVATE_KEY               the oracle PROPOSER_ROLE key; without it the keeper runs dry
 *   DATABASE_URL, PONDER_VIEWS_SCHEMA  optional: stock tokens from the indexer + team announcements
 *   KEEPER_INTERVAL_MS               default 60000
 *   ALERT_WEBHOOK_URL                optional: POST {"text": ...} (Slack/Discord-compatible) on ambiguous changes
 *   --once                           run one pass and exit
 */
const env = process.env;
const deployment = loadDeployment();
const client = createChainClient(env.RPC_URL ?? "");
const account = env.KEEPER_PRIVATE_KEY ? privateKeyToAccount(env.KEEPER_PRIVATE_KEY as Hash) : undefined;
const wallet = account
  ? createWalletClient({ account, chain: await chainFor(), transport: http(env.RPC_URL) })
  : undefined;
const database = env.DATABASE_URL ? createDb(env.DATABASE_URL, env.PONDER_VIEWS_SCHEMA ?? "dripp") : undefined;
const db = database?.db;
const DAY = 86_400;

async function chainFor() {
  const id = await client.getChainId();
  return { id, name: `chain-${id}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [env.RPC_URL!] } } };
}

async function tokens(): Promise<Address[]> {
  const set = new Set<Address>(deployment.stockTokens.map((t) => t.address));
  if (db) {
    const rows = await db.select().from(ponder.stockToken).where(isNotNull(ponder.stockToken.registeredAt));
    rows.forEach((r) => set.add(r.address));
  }
  return [...set];
}

/** Latest unused team announcement with an ex-date between 14 days ago and 2 days ahead. */
async function findAnnouncement(token: Address, now: number): Promise<Announcement | null> {
  if (!db) return null;
  const ca = app.corporateActions;
  const [row] = await db
    .select()
    .from(ca)
    .where(
      and(
        eq(ca.stockToken, token),
        isNull(ca.proposalTx),
        gte(ca.exDate, new Date((now - 14 * DAY) * 1000)),
        lte(ca.exDate, new Date((now + 2 * DAY) * 1000)),
      ),
    )
    .orderBy(desc(ca.exDate))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    action:
      row.kind === "split" && row.ratioNum && row.ratioDen
        ? { kind: "split", ratio: [row.ratioNum, row.ratioDen] }
        : { kind: "dividend" },
  };
}

async function markAnnouncementUsed(id: number, tx: string) {
  if (db && tx !== "dry-run") await db.update(app.corporateActions).set({ proposalTx: tx }).where(eq(app.corporateActions.id, id));
}

async function alert(text: string) {
  if (!env.ALERT_WEBHOOK_URL) return;
  await fetch(env.ALERT_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  }).catch((e) => console.error("alert failed:", e));
}

const log = (msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));

async function pass() {
  const actions = await runKeeperOnce(
    { client, wallet, oracle: deployment.oracle, findAnnouncement, markAnnouncementUsed, alert, log },
    await tokens(),
  );
  log("pass", { dryRun: !wallet, actions: actions.map((a) => `${a.type}:${a.token}`) });
  return actions;
}

if (process.argv.includes("--once")) {
  const actions = await pass();
  await database?.pool.end();
  process.exit(actions.some((a) => a.type === "error") ? 1 : 0);
} else {
  const interval = Number(env.KEEPER_INTERVAL_MS ?? 60_000);
  log("keeper started", { oracle: deployment.oracle, account: account?.address ?? "dry-run", interval });
  for (;;) {
    await pass().catch((e) => log("pass failed", { error: String(e) }));
    await new Promise((r) => setTimeout(r, interval));
  }
}
