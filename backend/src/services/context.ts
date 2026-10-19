import type { Cache } from "../cache.ts";
import type { ChainReader } from "../chain.ts";
import type { Config } from "../config.ts";
import type { Db } from "../db.ts";

export interface Deps {
  db: Db;
  chain: ChainReader;
  cache: Cache;
  config: Config;
}
