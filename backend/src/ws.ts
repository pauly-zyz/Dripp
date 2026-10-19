import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { and, eq, gte } from "drizzle-orm";
import { ponder } from "./db.ts";
import type { Deps } from "./services/context.ts";
import { getMarkets, proposalView, type MarketSnapshot } from "./services/markets.ts";
import { isoDate, str } from "./util.ts";

/**
 * WebSocket at /ws. Clients send {"type":"subscribe","channels":["prices","dividends"]}.
 *  - prices:    {"type":"prices","data":[{series, ptPrice, ytPrice, impliedFixedApy, impliedDividendApy}]}
 *               sent on subscribe and whenever a series' quote changes.
 *  - dividends: {"type":"dividend","event":"proposed"|"confirmed"|"disputed"|"scheduled","data":{...}}
 */
type Channel = "prices" | "dividends";

const quote = (m: MarketSnapshot) => ({
  series: m.series,
  vault: m.vault,
  ptPrice: m.ptPrice,
  ytPrice: m.ytPrice,
  impliedFixedApy: m.impliedFixedApy,
  impliedDividendApy: m.impliedDividendApy,
  tvl: m.tvl,
});

export function attachWebSocket(server: Server, deps: Deps) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const subs = new Map<WebSocket, Set<Channel>>();
  const lastQuote = new Map<string, string>();
  const seenEvents = new Set<string>();
  let eventWatermark = 0n;

  const send = (ws: WebSocket, msg: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  const broadcast = (channel: Channel, msg: unknown) => {
    for (const [ws, ch] of subs) if (ch.has(channel)) send(ws, msg);
  };

  wss.on("connection", (ws) => {
    subs.set(ws, new Set());
    send(ws, { type: "hello", channels: ["prices", "dividends"] });
    ws.on("message", async (raw) => {
      let msg: { type?: string; channels?: string[] };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return send(ws, { type: "error", error: "invalid JSON" });
      }
      const channels = (msg.channels ?? []).filter((c): c is Channel => c === "prices" || c === "dividends");
      const set = subs.get(ws)!;
      if (msg.type === "subscribe") {
        channels.forEach((c) => set.add(c));
        send(ws, { type: "subscribed", channels: [...set] });
        if (channels.includes("prices")) {
          const markets = await getMarkets(deps).catch(() => []);
          send(ws, { type: "prices", data: markets.map(quote) });
        }
      } else if (msg.type === "unsubscribe") {
        channels.forEach((c) => set.delete(c));
        send(ws, { type: "subscribed", channels: [...set] });
      }
    });
    ws.on("close", () => subs.delete(ws));
  });

  const pollPrices = async () => {
    const markets = await getMarkets(deps);
    const changed = markets.filter((m) => {
      const key = JSON.stringify([m.ptPrice.shares, m.ytPrice.shares, m.tvl.shares]);
      if (lastQuote.get(m.vault) === key) return false;
      lastQuote.set(m.vault, key);
      return true;
    });
    if (changed.length) broadcast("prices", { type: "prices", data: changed.map(quote) });
  };

  const pollEvents = async (initial = false) => {
    const { proposal, multiplierUpdate, stockToken } = ponder;
    const [proposals, updates, stocks] = await Promise.all([
      deps.db.select().from(proposal).where(gte(proposal.updatedAt, eventWatermark)),
      deps.db
        .select()
        .from(multiplierUpdate)
        .where(and(gte(multiplierUpdate.announcedAt, eventWatermark), eq(multiplierUpdate.cancelled, false))),
      deps.db.select().from(stockToken),
    ]);
    const ticker = new Map(stocks.map((s) => [s.address, s.ticker]));
    for (const p of proposals) {
      const key = `p:${p.id}:${p.status}`;
      if (seenEvents.has(key)) continue;
      seenEvents.add(key);
      if (p.updatedAt > eventWatermark) eventWatermark = p.updatedAt;
      if (!initial) {
        const event = p.status === "pending" ? "proposed" : p.status;
        broadcast("dividends", { type: "dividend", event, data: { ...proposalView(p), ticker: ticker.get(p.stockToken) ?? null } });
      }
    }
    for (const u of updates) {
      const key = `m:${u.id}`;
      if (seenEvents.has(key)) continue;
      seenEvents.add(key);
      if (u.announcedAt > eventWatermark) eventWatermark = u.announcedAt;
      if (!initial) {
        broadcast("dividends", {
          type: "dividend",
          event: "scheduled",
          data: {
            stockToken: u.stockToken,
            ticker: ticker.get(u.stockToken) ?? null,
            fromMultiplier: str(u.oldMultiplier),
            toMultiplier: str(u.newMultiplier),
            effectiveAt: isoDate(u.effectiveAt),
            txHash: u.txHash,
          },
        });
      }
    }
  };

  const loop = (fn: () => Promise<void>, ms: number) => {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      await fn().catch((e) => console.error("ws poll failed:", e));
      if (!stopped) timer = setTimeout(tick, ms);
    };
    let timer = setTimeout(tick, ms);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  };

  const stops: (() => void)[] = [];
  void pollEvents(true)
    .catch((e) => console.error("ws initial poll failed:", e))
    .finally(() => {
      stops.push(loop(() => pollEvents(), deps.config.eventPollMs));
    });
  stops.push(loop(pollPrices, deps.config.pricePollMs));

  return {
    wss,
    close: () => {
      stops.forEach((s) => s());
      wss.close();
    },
  };
}
