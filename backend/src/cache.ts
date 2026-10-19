import { Redis } from "ioredis";

/** JSON cache + counters. Redis when REDIS_URL is set, in-process memory otherwise. */
export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  /** Increments a counter that expires `ttlSeconds` after its first increment. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  close(): Promise<void>;
}

const json = {
  stringify: (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x)),
  parse: <T>(s: string) =>
    JSON.parse(s, (_k, x) => (typeof x === "string" && /^-?\d+n$/.test(x) ? BigInt(x.slice(0, -1)) : x)) as T,
};

export function createCache(redisUrl?: string): Cache {
  return redisUrl ? new RedisCache(redisUrl) : new MemoryCache();
}

export class MemoryCache implements Cache {
  private store = new Map<string, { value: string; expires: number }>();

  async get<T>(key: string) {
    const e = this.store.get(key);
    if (!e || e.expires < Date.now()) return undefined;
    return json.parse<T>(e.value);
  }

  async set(key: string, value: unknown, ttlSeconds: number) {
    this.store.set(key, { value: json.stringify(value), expires: Date.now() + ttlSeconds * 1000 });
  }

  async incr(key: string, ttlSeconds: number) {
    const e = this.store.get(key);
    const n = e && e.expires >= Date.now() ? Number(e.value) + 1 : 1;
    this.store.set(key, { value: String(n), expires: e && e.expires >= Date.now() ? e.expires : Date.now() + ttlSeconds * 1000 });
    return n;
  }

  async close() {}
}

class RedisCache implements Cache {
  private redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2 });
  }

  async get<T>(key: string) {
    const v = await this.redis.get(key);
    return v === null ? undefined : json.parse<T>(v);
  }

  async set(key: string, value: unknown, ttlSeconds: number) {
    await this.redis.set(key, json.stringify(value), "EX", Math.max(1, Math.ceil(ttlSeconds)));
  }

  async incr(key: string, ttlSeconds: number) {
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, Math.max(1, Math.ceil(ttlSeconds)));
    return n;
  }

  async close() {
    await this.redis.quit();
  }
}

/** Returns the cached value or computes and caches it. */
export async function cached<T>(cache: Cache, key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const hit = await cache.get<T>(key);
  if (hit !== undefined) return hit;
  const v = await fn();
  await cache.set(key, v, ttlSeconds);
  return v;
}
