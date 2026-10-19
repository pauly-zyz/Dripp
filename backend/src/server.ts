import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { createApp } from "./app.ts";
import { createCache } from "./cache.ts";
import { ChainReader, createChainClient } from "./chain.ts";
import { loadConfig } from "./config.ts";
import { createDb } from "./db.ts";
import { migrate } from "./migrate.ts";
import { attachWebSocket } from "./ws.ts";

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl, config.ponderSchema);
await migrate(pool);
const deps = { db, config, cache: createCache(config.redisUrl), chain: new ChainReader(createChainClient(config.rpcUrl)) };

const server = serve({ fetch: createApp(deps).fetch, port: config.port }, (info) =>
  console.log(`dripp api listening on :${info.port} (indexer schema "${config.ponderSchema}")`),
) as Server;
const ws = attachWebSocket(server, deps);

const shutdown = async () => {
  ws.close();
  server.close();
  await deps.cache.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
