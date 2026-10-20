/**
 * End-to-end API test. Run by scripts/e2e-local.sh against a local chain that went through:
 * seed 1 (pools, splits, zaps, 1% dividend, 2:1 split announced) -> keeper proposes + confirms the dividend
 * -> seed 2 (alice claims + merges) -> 2:1 split effective -> keeper proposes + confirms it as a split
 * -> seed 3 (next 1% dividend announced for +30 days).
 */
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, erc20Abi, http, type Address, type Hex } from "viem";
import { foundry } from "viem/chains";
import { DrippRouterAbi, swapRouter02Abi } from "@dripp/shared";
import { commentMessage } from "../src/services/comments.ts";
import { referralMessage } from "../src/services/referrals.ts";

const API = process.env.API_URL ?? "http://127.0.0.1:8787";
const ADMIN = process.env.ADMIN_API_KEY ?? "test";
const alice = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");
const bob = privateKeyToAccount("0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e");
const carol = privateKeyToAccount("0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356");

async function get<T = any>(path: string): Promise<T> {
  const r = await fetch(API + path);
  expect(r.status, `${path}: ${await r.clone().text()}`).toBe(200);
  return r.json() as Promise<T>;
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(API + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as any };
}

describe("markets", () => {
  it("lists the series with prices, implied yields, TVL and risk", async () => {
    const markets = await get<any[]>("/markets");
    expect(markets).toHaveLength(1);
    const m = markets[0];
    expect(m.series).toBe("AAPL-MAR27");
    expect(m.stock.ticker).toBe("AAPL");
    // 1% dividend counted, 2:1 split not: index 1.01, and each PT is now worth ~2 stock shares
    expect(m.index).toBe("1010000000000000000");
    expect(m.stockSharesPerPT).toBeCloseTo(2, 6);
    expect(m.ptPrice.shares).toBeGreaterThan(0.5);
    expect(m.ytPrice.shares).toBeGreaterThan(0);
    expect(typeof m.impliedFixedApy).toBe("number");
    expect(typeof m.impliedDividendApy).toBe("number");
    expect(m.tvl.shares).toBeGreaterThan(400);
    expect(m.pools.map((p: any) => p.side).sort()).toEqual(["PT", "YT"]);
    expect(m.risk.score).toBeGreaterThanOrEqual(0);
    expect(m.risk.score).toBeLessThanOrEqual(100);
    expect(Object.keys(m.risk.components).sort()).toEqual(["concentration", "liquidity", "maturity", "oracle"]);
  });

  it("filters by stock and maturity", async () => {
    expect(await get("/markets?stock=aapl&maturity=MAR27")).toHaveLength(1);
    expect(await get("/markets?stock=TSLA")).toHaveLength(0);
  });

  it("serves the series detail by name or vault address", async () => {
    const d = await get("/markets/AAPL-MAR27");
    expect(d.dividendHistory.map((p: any) => `${p.kind}:${p.status}`).sort()).toEqual([
      "dividend:confirmed",
      "split:confirmed",
    ]);
    const dividend = d.dividendHistory.find((p: any) => p.kind === "dividend");
    expect(dividend.dividendPct).toBeCloseTo(1, 9);
    expect(d.dividendHistory.find((p: any) => p.kind === "split").splitRatio).toBeCloseTo(2, 9);
    expect(d.recentSwaps.length).toBeGreaterThanOrEqual(2);
    expect(d.priceHistory.PT.length).toBeGreaterThanOrEqual(1);
    expect((await get(`/markets/${d.vault}`)).series).toBe("AAPL-MAR27");
    expect((await fetch(`${API}/markets/NOPE-JAN99`)).status).toBe(404);
  });
});

describe("oracle and calendar", () => {
  it("lists proposals", async () => {
    const all = await get<any[]>("/oracle/proposals");
    expect(all.map((p) => p.kind).sort()).toEqual(["dividend", "split"]);
    expect(all.every((p) => p.status === "confirmed")).toBe(true);
    expect(await get("/oracle/proposals?status=pending")).toHaveLength(0);
    expect((await fetch(`${API}/oracle/proposals?status=nope`)).status).toBe(400);
  });

  it("shows confirmed history, the on-chain scheduled dividend and team announcements", async () => {
    const m = (await get<any[]>("/markets"))[0];
    const created = await post(
      "/admin/corporate-actions",
      { stockToken: m.stock.address, kind: "dividend", exDate: new Date(Date.now() + 40 * 86400e3).toISOString(), amountUsd: "0.26" },
      { "x-admin-key": ADMIN },
    );
    expect(created.status).toBe(201);
    expect((await post("/admin/corporate-actions", {}, { "x-admin-key": "wrong" })).status).toBe(401);

    const cal = await get<any[]>("/calendar?stock=AAPL&to=2030-01-01");
    const types = cal.map((e) => `${e.type}:${e.kind}`);
    expect(types).toContain("confirmed:dividend");
    expect(types).toContain("confirmed:split");
    expect(types).toContain("scheduled:dividend");
    expect(types).toContain("announced:dividend");
    const scheduled = cal.find((e) => e.type === "scheduled");
    expect(scheduled.dividendPct).toBeCloseTo(1, 6);
    expect(cal.map((e) => e.timestamp)).toEqual([...cal.map((e) => e.timestamp)].sort((a, b) => a - b));
  });
});

describe("users", () => {
  it("split did not add to bob's claimable yield", async () => {
    const c = await get(`/users/${bob.address}/claimable`);
    expect(c.items).toHaveLength(1);
    expect(c.items[0].gross).toBe(process.env.E2E_BOB_CLAIMABLE_BEFORE_SPLIT);
    // 5% YT fee
    expect(BigInt(c.items[0].fee)).toBe((BigInt(c.items[0].gross) * 500n) / 10_000n);
  });

  it("alice's portfolio shows positions and activity, nothing left to claim", async () => {
    const p = await get(`/users/${alice.address}/portfolio`);
    expect(p.positions.map((x: any) => x.kind).sort()).toEqual(["PT", "YT"]);
    expect(p.claimable).toHaveLength(0);
    const types = p.activity.map((a: any) => a.type);
    for (const t of ["claim", "merge", "split", "zap:PT", "buy:PT"]) expect(types).toContain(t);

    // PnL: cost = 50 shares split at index 1.0 + stock paid for PT in the pool (index 1.0)
    const buy = p.activity.find((a: any) => a.type === "buy:PT");
    const pnl = p.pnl.find((x: any) => x.series === "AAPL-MAR27");
    expect(pnl.costShares).toBeCloseTo(50 + Number(buy.stockAmount) / 1e18, 9);
    expect(pnl.proceedsShares).toBeGreaterThan(10); // merge 10 PT+YT + claimed dividend
    expect(pnl.pnlShares).toBeCloseTo(pnl.valueShares + pnl.proceedsShares - pnl.costShares, 9);
    expect((await fetch(`${API}/users/0x1234/portfolio`)).status).toBe(400);
  });
});

describe("growth", () => {
  it("referrals need the referee's signature and count towards the referrer", async () => {
    const message = referralMessage(alice.address.toLowerCase() as any, bob.address.toLowerCase() as any);
    const signature = await bob.signMessage({ message });
    const bad = await post("/referrals", { referee: bob.address, referrer: alice.address, signature: await carol.signMessage({ message }) });
    expect(bad.status).toBe(401);
    const ok = await post("/referrals", { referee: bob.address, referrer: alice.address, signature });
    expect(ok.status).toBe(201);
    expect((await post("/referrals", { referee: bob.address, referrer: alice.address, signature })).status).toBe(409);

    const info = await get(`/referrals/${alice.address}`);
    expect(info.referees.map((r: any) => r.address)).toEqual([bob.address.toLowerCase()]);
    expect(info.referralPoints).toBeGreaterThan(0);
    expect((await get(`/referrals/${bob.address}`)).referrer).toBe(alice.address.toLowerCase());
  });

  it("leaderboard ranks traders by points, volume or yield", async () => {
    const byYield = await get("/leaderboard?metric=yield");
    expect(byYield.entries[0].address).toBe(alice.address.toLowerCase());
    expect(byYield.entries[0].yieldClaimedShares).toBeGreaterThan(0);
    const byPoints = await get("/leaderboard");
    const a = byPoints.entries.find((e: any) => e.address === alice.address.toLowerCase());
    expect(a.referees).toBe(1);
    expect(a.points).toBeCloseTo(a.basePoints + a.referralPoints, 1);
  });
});

describe("comments", () => {
  const sign = async (account: typeof alice, body: string, timestamp = Math.floor(Date.now() / 1000)) => ({
    author: account.address,
    body,
    timestamp,
    signature: await account.signMessage({ message: commentMessage("AAPL-MAR27", timestamp, body) }),
  });

  it("posts signed comments with rate limit and moderation", async () => {
    const first = await post("/markets/AAPL-MAR27/comments", await sign(alice, "PT at a discount looks good  \n\n\n\nfor fixed income"));
    expect(first.status).toBe(201);
    expect(first.body.body).toBe("PT at a discount looks good\n\nfor fixed income");

    expect((await post("/markets/AAPL-MAR27/comments", await sign(alice, "again"))).status).toBe(429);

    const forged = { ...(await sign(carol, "hello")), author: bob.address };
    expect((await post("/markets/AAPL-MAR27/comments", forged)).status).toBe(401);
    expect((await post("/markets/AAPL-MAR27/comments", await sign(bob, "this is a SCAM"))).status).toBe(422);
    expect((await post("/markets/AAPL-MAR27/comments", await sign(carol, "old", 1_600_000_000))).status).toBe(400);

    const list = await get("/markets/AAPL-MAR27/comments");
    expect(list.comments.map((c: any) => c.author)).toEqual([alice.address.toLowerCase()]);

    const del = await fetch(`${API}/admin/comments/${first.body.id}`, { method: "DELETE", headers: { "x-admin-key": ADMIN } });
    expect(del.status).toBe(200);
    expect((await get("/markets/AAPL-MAR27/comments")).comments).toHaveLength(0);
  });
});

describe("websocket", () => {
  it("pushes prices on subscribe", async () => {
    const ws = new WebSocket(API.replace("http", "ws") + "/ws");
    const msg = await new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("no prices message")), 10_000);
      ws.on("open", () => ws.send(JSON.stringify({ type: "subscribe", channels: ["prices", "dividends"] })));
      ws.on("message", (raw) => {
        const m = JSON.parse(String(raw));
        if (m.type === "prices") {
          clearTimeout(t);
          resolve(m);
        }
      });
      ws.on("error", reject);
    });
    ws.close();
    expect(msg.data[0].series).toBe("AAPL-MAR27");
    expect(typeof msg.data[0].ptPrice.shares).toBe("number");
  });
});

describe("protocol and quotes", () => {
  const rpc = http(process.env.RPC_URL ?? "http://127.0.0.1:8545");
  // on-chain steps: poll receipts quickly (viem's default is 4s)
  const pub = createPublicClient({ chain: foundry, transport: rpc, pollingInterval: 250 });
  const wallet = createWalletClient({ account: carol, chain: foundry, transport: rpc, pollingInterval: 250 });
  const balance = (token: Address) =>
    pub.readContract({ abi: erc20Abi, address: token, functionName: "balanceOf", args: [carol.address] });

  it("exposes contract addresses, fees and reserves", async () => {
    const p = await get("/protocol");
    expect(p.contracts.router).toMatch(/^0x[0-9a-f]{40}$/);
    expect(p.fees).toEqual({ ytFeeBps: 500, zapFeeBps: 10, stockDripShareBps: 6000 });
    expect(p.reserves).toHaveLength(1);
    expect(p.reserves[0].backingRatio).toBeGreaterThanOrEqual(1);
    expect(p.stockTokens[0].ticker).toBe("AAPL");
  });

  it("a buy quote executes through DrippRouter and delivers at least minOut", async () => {
    const q = await get("/quote?series=AAPL-MAR27&side=buy&asset=PT&token=ETH&amount=100000000000000000&slippageBps=50");
    expect(q.route.length).toBeGreaterThanOrEqual(3); // WETH -> ... -> stock -> PT
    const m = (await get<any[]>("/markets"))[0];
    const before = await balance(m.pt);
    const block = await pub.getBlock();
    const hash = await wallet.writeContract({
      address: q.to,
      abi: DrippRouterAbi,
      functionName: "zap",
      args: [
        {
          vault: q.params.vault,
          target: q.params.target,
          tokenIn: q.params.tokenIn,
          amountIn: BigInt(q.params.amountIn),
          path: q.params.path,
          minOut: BigInt(q.params.minOut),
          receiver: carol.address,
          deadline: block.timestamp + 600n,
        },
      ],
      value: BigInt(q.value),
    });
    expect((await pub.waitForTransactionReceipt({ hash })).status).toBe("success");
    const got = (await balance(m.pt)) - before;
    expect(got).toBe(BigInt(q.amountOut)); // nothing else moved the pool in between
  });

  it("a sell quote executes through the swap router", async () => {
    const m = (await get<any[]>("/markets"))[0];
    const amount = (await balance(m.pt)) / 2n;
    const q = await get(`/quote?series=AAPL-MAR27&side=sell&asset=PT&token=STOCK&amount=${amount}`);
    await pub.waitForTransactionReceipt({
      hash: await wallet.writeContract({
        address: q.approve.token,
        abi: erc20Abi,
        functionName: "approve",
        args: [q.approve.spender, BigInt(q.approve.amount)],
      }),
    });
    const before = await balance(m.stock.address);
    const hash = await wallet.writeContract({
      address: q.to,
      abi: swapRouter02Abi,
      functionName: "exactInput",
      args: [{ path: q.params.path as Hex, recipient: carol.address, amountIn: amount, amountOutMinimum: BigInt(q.params.minOut) }],
    });
    expect((await pub.waitForTransactionReceipt({ hash })).status).toBe("success");
    expect((await balance(m.stock.address)) - before).toBe(BigInt(q.amountOut));
  });

  it("rejects bad quote requests", async () => {
    expect((await fetch(`${API}/quote?series=AAPL-MAR27&side=sell&asset=PT&token=ETH&amount=1`)).status).toBe(400);
    expect((await fetch(`${API}/quote?series=AAPL-MAR27&side=buy&asset=PT&token=ETH&amount=abc`)).status).toBe(400);
  });
});
