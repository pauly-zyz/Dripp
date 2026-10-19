import { boolean, integer, pgSchema, serial, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

/** Tables owned by the backend (not the indexer). Created by src/migrate.ts. */
export const appSchema = pgSchema("dripp_app");

export const comments = appSchema.table(
  "comments",
  {
    id: serial("id").primaryKey(),
    series: text("series").notNull(),
    author: text("author").notNull(),
    body: text("body").notNull(),
    signature: text("signature").notNull(),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    hidden: boolean("hidden").notNull().default(false),
    hiddenReason: text("hidden_reason"),
  },
  (t) => [uniqueIndex("comments_signature_key").on(t.signature), index("comments_series_idx").on(t.series, t.id)],
);

export const bannedWallets = appSchema.table("banned_wallets", {
  address: text("address").primaryKey(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const referrals = appSchema.table(
  "referrals",
  {
    referee: text("referee").primaryKey(),
    referrer: text("referrer").notNull(),
    signature: text("signature").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("referrals_referrer_idx").on(t.referrer)],
);

/** Announced corporate actions (ex-dividend calendar input and keeper classification hints). */
export const corporateActions = appSchema.table(
  "corporate_actions",
  {
    id: serial("id").primaryKey(),
    stockToken: text("stock_token").notNull(),
    kind: text("kind").notNull(), // "dividend" | "split"
    exDate: timestamp("ex_date", { withTimezone: true }).notNull(),
    payDate: timestamp("pay_date", { withTimezone: true }),
    /** Cash dividend per share in USD, informational. */
    amountUsd: text("amount_usd"),
    ratioNum: integer("ratio_num"),
    ratioDen: integer("ratio_den"),
    note: text("note"),
    /** Oracle proposal tx sent by the keeper based on this announcement. */
    proposalTx: text("proposal_tx"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("corporate_actions_stock_idx").on(t.stockToken, t.exDate)],
);
