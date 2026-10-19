import { describe, expect, it } from "vitest";
import { classifyMultiplierChange } from "../src/classify.ts";

const e = 10n ** 18n;
const m = (x: number) => BigInt(Math.round(x * 1e6)) * 10n ** 12n;

describe("classifyMultiplierChange", () => {
  it("small rise is a dividend", () => {
    expect(classifyMultiplierChange(e, m(1.004))).toEqual({ kind: "dividend" });
    expect(classifyMultiplierChange(m(2), m(2.02))).toEqual({ kind: "dividend" });
  });

  it("exact nice ratios are splits, both directions", () => {
    expect(classifyMultiplierChange(e, m(2))).toEqual({ kind: "split" });
    expect(classifyMultiplierChange(m(3), m(4.5))).toEqual({ kind: "split" }); // 3:2
    expect(classifyMultiplierChange(e, m(0.1))).toEqual({ kind: "split" }); // 1:10 reverse
  });

  it("split plus dividend is mixed", () => {
    expect(classifyMultiplierChange(e, m(2.06))).toEqual({ kind: "mixed", splitRatio: 2n * e });
    expect(classifyMultiplierChange(e, m(0.515))).toEqual({ kind: "mixed", splitRatio: e / 2n });
    // a 10% dividend on top of a split is too big to guess: needs an announcement
    expect(classifyMultiplierChange(e, m(2.2)).kind).toBe("ambiguous");
  });

  it("unexplained changes are ambiguous", () => {
    expect(classifyMultiplierChange(e, m(1.7)).kind).toBe("ambiguous");
    expect(classifyMultiplierChange(e, m(0.97)).kind).toBe("ambiguous");
    expect(classifyMultiplierChange(e, e).kind).toBe("ambiguous");
  });

  it("announced actions take precedence", () => {
    // 1.25 would be read as a 5:4 split, but the calendar says it is a (big) dividend
    expect(classifyMultiplierChange(e, m(1.12), { announced: { kind: "dividend" } })).toEqual({ kind: "dividend" });
    expect(classifyMultiplierChange(e, m(1.25), { announced: { kind: "dividend" } }).kind).toBe("ambiguous");
    expect(classifyMultiplierChange(e, m(1.7), { announced: { kind: "split", ratio: [17, 10] } })).toEqual({
      kind: "split",
    });
    expect(classifyMultiplierChange(e, m(1.734), { announced: { kind: "split", ratio: [17, 10] } })).toEqual({
      kind: "mixed",
      splitRatio: (17n * e) / 10n,
    });
  });
});
