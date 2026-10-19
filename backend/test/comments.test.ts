import { describe, expect, it } from "vitest";
import { commentMessage, moderate } from "../src/services/comments.ts";

const opts = { maxLength: 20, bannedWords: ["scam"] };

describe("moderate", () => {
  it("normalizes whitespace", () => {
    expect(moderate("  hi  \r\n\r\n\r\n\r\nthere ", opts)).toBe("hi\n\nthere");
  });

  it("rejects empty, too long, banned words and link spam", () => {
    expect(() => moderate("   \n ", opts)).toThrow("empty");
    expect(() => moderate("x".repeat(21), opts)).toThrow("longer than 20");
    expect(() => moderate("total SCAM", opts)).toThrow("banned");
    expect(() => moderate("https://a.io https://b.io", { ...opts, maxLength: 100 })).toThrow("links");
    expect(moderate("see https://a.io", { ...opts, maxLength: 100 })).toBe("see https://a.io");
  });

  it("signs series, timestamp and body", () => {
    expect(commentMessage("AAPL-MAR27", 1700000000, "gm")).toBe("Dripp comment\nSeries: AAPL-MAR27\nTimestamp: 1700000000\n\ngm");
  });
});
