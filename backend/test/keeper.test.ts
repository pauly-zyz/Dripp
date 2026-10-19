import { describe, expect, it } from "vitest";
import type { Address, PublicClient } from "viem";
import { runKeeperOnce } from "../src/keeper/keeper.ts";

const TOKEN = "0x00000000000000000000000000000000000000aa" as Address;
const ORACLE = "0x00000000000000000000000000000000000000bb" as Address;
const e = 10n ** 18n;

/** Fake chain answering the oracle / token reads the keeper makes. */
function fakeClient(state: {
  now: number;
  pending?: { id: bigint; disputeEndsAt: number };
  confirmed: bigint;
  live: bigint;
}) {
  return {
    getBlock: async () => ({ timestamp: BigInt(state.now) }),
    readContract: async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case "isRegistered":
          return true;
        case "pendingProposal":
          return state.pending ? [true, state.pending.id] : [false, 0n];
        case "getProposal":
          return { disputeEndsAt: BigInt(state.pending!.disputeEndsAt) };
        case "needsProposal":
          return !state.pending && state.live !== state.confirmed;
        case "confirmedMultiplier":
          return state.confirmed;
        case "uiMultiplier":
          return state.live;
      }
      throw new Error(`unexpected read ${functionName}`);
    },
  } as unknown as PublicClient;
}

const run = (client: PublicClient, extra = {}) => runKeeperOnce({ client, oracle: ORACLE, ...extra }, [TOKEN]);

describe("keeper (dry run)", () => {
  it("idles when nothing changed", async () => {
    expect(await run(fakeClient({ now: 0, confirmed: e, live: e }))).toEqual([{ type: "idle", token: TOKEN }]);
  });

  it("proposes a small rise as a dividend and an exact 2:1 as a split", async () => {
    const [div] = await run(fakeClient({ now: 0, confirmed: e, live: (e * 1005n) / 1000n }));
    expect(div).toMatchObject({ type: "propose", kind: "dividend" });
    const [split] = await run(fakeClient({ now: 0, confirmed: e, live: 2n * e }));
    expect(split).toMatchObject({ type: "propose", kind: "split" });
  });

  it("waits inside the dispute window and confirms after it", async () => {
    const pending = { id: 3n, disputeEndsAt: 1000 };
    expect(await run(fakeClient({ now: 400, pending, confirmed: e, live: 2n * e }))).toEqual([
      { type: "wait", token: TOKEN, proposalId: 3n, secondsLeft: 600 },
    ]);
    expect(await run(fakeClient({ now: 1000, pending, confirmed: e, live: 2n * e }))).toEqual([
      { type: "confirm", token: TOKEN, proposalId: 3n, tx: undefined },
    ]);
  });

  it("alerts instead of proposing an unexplained change", async () => {
    const alerts: string[] = [];
    const [a] = await run(fakeClient({ now: 0, confirmed: e, live: (e * 17n) / 10n }), {
      alert: async (t: string) => void alerts.push(t),
    });
    expect(a).toMatchObject({ type: "ambiguous" });
    expect(alerts[0]).toContain("could not be classified");
  });

  it("uses a matching team announcement and marks it used", async () => {
    const used: number[] = [];
    const [a] = await run(fakeClient({ now: 0, confirmed: e, live: (e * 125n) / 100n }), {
      findAnnouncement: async () => ({ id: 7, action: { kind: "dividend" } }),
      markAnnouncementUsed: async (id: number) => void used.push(id),
    });
    // 1.25x would look like a 5:4 split, but the announcement says dividend; 25% > 15% cap -> ambiguous
    expect(a).toMatchObject({ type: "ambiguous" });
    const [b] = await run(fakeClient({ now: 0, confirmed: e, live: (e * 112n) / 100n }), {
      findAnnouncement: async () => ({ id: 8, action: { kind: "dividend" } }),
      markAnnouncementUsed: async (id: number) => void used.push(id),
    });
    expect(b).toMatchObject({ type: "propose", kind: "dividend" });
    expect(used).toEqual([8]);
  });
});
