import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { setDatabaseSchema } from "@ponder/client";
import * as ponder from "@dripp/indexer/schema";
import * as app from "./appSchema.ts";

export { ponder, app };
export type Db = NodePgDatabase<typeof ponder & typeof app>;

/** Drizzle over Postgres: indexer tables (read-only, in `ponderSchema`) + backend tables (dripp_app). */
export function createDb(databaseUrl: string, ponderSchema: string) {
  setDatabaseSchema(ponder, ponderSchema);
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle(pool, { schema: { ...ponder, ...app }, casing: "snake_case" }) as Db;
  return { db, pool };
}
