import pg from "pg";

/** Idempotent DDL for the backend-owned tables in src/appSchema.ts. */
export const MIGRATION = `
CREATE SCHEMA IF NOT EXISTS dripp_app;
CREATE TABLE IF NOT EXISTS dripp_app.comments (
  id serial PRIMARY KEY,
  series text NOT NULL,
  author text NOT NULL,
  body text NOT NULL,
  signature text NOT NULL,
  signed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  hidden boolean NOT NULL DEFAULT false,
  hidden_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS comments_signature_key ON dripp_app.comments (signature);
CREATE INDEX IF NOT EXISTS comments_series_idx ON dripp_app.comments (series, id);
CREATE TABLE IF NOT EXISTS dripp_app.banned_wallets (
  address text PRIMARY KEY,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dripp_app.referrals (
  referee text PRIMARY KEY,
  referrer text NOT NULL,
  signature text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON dripp_app.referrals (referrer);
CREATE TABLE IF NOT EXISTS dripp_app.corporate_actions (
  id serial PRIMARY KEY,
  stock_token text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('dividend', 'split')),
  ex_date timestamptz NOT NULL,
  pay_date timestamptz,
  amount_usd text,
  ratio_num integer,
  ratio_den integer,
  note text,
  proposal_tx text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS corporate_actions_stock_idx ON dripp_app.corporate_actions (stock_token, ex_date);
`;

export async function migrate(pool: pg.Pool) {
  await pool.query(MIGRATION);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(pool);
  await pool.end();
  console.log("migrated dripp_app");
}
