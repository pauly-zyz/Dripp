import { loadDeployment, type Deployment } from "@dripp/shared";

export interface Config {
  port: number;
  databaseUrl: string;
  /** Postgres schema with the indexer's tables (the `ponder start --views-schema`). */
  ponderSchema: string;
  rpcUrl: string;
  deployment: Deployment;
  redisUrl?: string;
  adminApiKey?: string;
  /** How often market snapshots are recomputed and pushed over WebSocket. */
  pricePollMs: number;
  /** How often the indexer is polled for new dividend / multiplier events. */
  eventPollMs: number;
  comments: { minIntervalSeconds: number; maxPerDay: number; maxLength: number; bannedWords: string[] };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = (name: string) => {
    const v = env[name];
    if (!v) throw new Error(`${name} is not set`);
    return v;
  };
  return {
    port: Number(env.PORT ?? 8080),
    databaseUrl: required("DATABASE_URL"),
    ponderSchema: env.PONDER_VIEWS_SCHEMA ?? "dripp",
    rpcUrl: required("RPC_URL"),
    deployment: loadDeployment(required("DRIPP_DEPLOYMENT")),
    redisUrl: env.REDIS_URL || undefined,
    adminApiKey: env.ADMIN_API_KEY || undefined,
    pricePollMs: Number(env.PRICE_POLL_MS ?? 10_000),
    eventPollMs: Number(env.EVENT_POLL_MS ?? 5_000),
    comments: {
      minIntervalSeconds: Number(env.COMMENT_MIN_INTERVAL_S ?? 30),
      maxPerDay: Number(env.COMMENT_MAX_PER_DAY ?? 30),
      maxLength: Number(env.COMMENT_MAX_LENGTH ?? 500),
      bannedWords: (env.COMMENT_BANNED_WORDS ?? "")
        .split(",")
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean),
    },
  };
}
