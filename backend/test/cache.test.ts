import { describe, expect, it } from "vitest";
import { MemoryCache, cached } from "../src/cache.ts";

describe("MemoryCache", () => {
  it("round-trips bigints and expires", async () => {
    const c = new MemoryCache();
    await c.set("k", { a: 1n, b: "x" }, 60);
    expect(await c.get("k")).toEqual({ a: 1n, b: "x" });
    await c.set("gone", 1, -1);
    expect(await c.get("gone")).toBeUndefined();
  });

  it("counts within a window", async () => {
    const c = new MemoryCache();
    expect(await c.incr("n", 60)).toBe(1);
    expect(await c.incr("n", 60)).toBe(2);
  });

  it("cached() computes once", async () => {
    const c = new MemoryCache();
    let calls = 0;
    const f = async () => ++calls;
    expect(await cached(c, "x", 60, f)).toBe(1);
    expect(await cached(c, "x", 60, f)).toBe(1);
  });
});
