#!/usr/bin/env bash
# Local end-to-end run: anvil + canonical Uniswap v3 + Dripp contracts + Ponder indexer + keeper + API.
#
#   bash scripts/e2e-local.sh          # full run with assertions (backend/test/e2e.test.ts)
#   E2E_KEEP=1 bash scripts/e2e-local.sh   # leave services running afterwards
#
# Needs: foundry (anvil, forge, cast), Postgres (DATABASE_URL or a local cluster), Redis (optional), pnpm.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${E2E_WORK:-$ROOT/.e2e}"
mkdir -p "$WORK"
export PATH="$HOME/.foundry/bin:$PATH"

RPC=http://127.0.0.1:${ANVIL_PORT:-8545}
DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
MULTISIG=0x70997970C51812dc3A010C7d01b50e0d17dc79C8   # anvil #1
KEEPER=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC     # anvil #2
KEEPER_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
TREASURY=0x90F79bf6EB2c4f870365E51D7f2B9e2Afa0E6b5b   # anvil #3
# No DATABASE_URL: use (and if needed start) the local Postgres 16 cluster and recreate dripp_e2e.
# With DATABASE_URL: use that database and only reset the schemas this script owns.
if [[ -z "${DATABASE_URL:-}" ]]; then LOCAL_PG=1; else LOCAL_PG=0; fi
export DATABASE_URL="${DATABASE_URL:-postgresql://dripp:dripp@127.0.0.1:5432/dripp_e2e}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379/15}"
export PONDER_VIEWS_SCHEMA=dripp
PIDS=()

cleanup() {
  if [[ "${E2E_KEEP:-0}" != "1" ]]; then
    # each service runs in its own process group (setsid): kill the whole group
    for p in "${PIDS[@]:-}"; do [[ -n "$p" ]] && kill -- "-$p" 2>/dev/null || true; done
  fi
}
trap cleanup EXIT

log() { echo -e "\n== $*"; }

wait_http() { # url, seconds
  for _ in $(seq 1 "$2"); do curl -sf "$1" >/dev/null && return 0; sleep 1; done
  echo "timeout waiting for $1" >&2; return 1
}

log "Postgres / Redis"
if [[ "$LOCAL_PG" == "1" ]]; then
  if ! pg_isready -h 127.0.0.1 -q; then
    (pg_ctlcluster 16 main start 2>/dev/null || sudo pg_ctlcluster 16 main start)
    sleep 2
  fi
  su postgres -c "psql -q -c \"DO \\\$\\\$BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='dripp') THEN CREATE ROLE dripp LOGIN PASSWORD 'dripp' CREATEDB; END IF; END\\\$\\\$;\""
  su postgres -c "psql -q -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='dripp_e2e'\"" >/dev/null
  su postgres -c "psql -q -c 'DROP DATABASE IF EXISTS dripp_e2e'" && su postgres -c "psql -q -c 'CREATE DATABASE dripp_e2e OWNER dripp'"
else
  psql "$DATABASE_URL" -q -c "DROP SCHEMA IF EXISTS dripp_indexer, dripp, dripp_app, ponder_sync, ponder_rpc_cache_1 CASCADE" 2>&1 | grep -v NOTICE || true
fi
redis-cli -u "$REDIS_URL" ping >/dev/null 2>&1 || { redis-server --daemonize yes --port 6379 >/dev/null; sleep 1; }
redis-cli -u "$REDIS_URL" flushdb >/dev/null 2>&1 || echo "warning: could not flush $REDIS_URL"

log "anvil"
if curl -sf -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId"}' "$RPC" >/dev/null; then
  echo "something is already listening on $RPC; stop it first" >&2; exit 1
fi
setsid anvil --port "${ANVIL_PORT:-8545}" --silent > "$WORK/anvil.log" 2>&1 &
PIDS+=($!)
sleep 2

cd "$ROOT/contracts"
log "Uniswap v3 + WETH/USDG/stock"
forge script test/router/LocalRobinhood.s.sol --rpc-url "$RPC" --broadcast --slow --private-key "$DEPLOYER_KEY" > "$WORK/uniswap.log" 2>&1

log "Dripp contracts"
python3 - "$ROOT/contracts/cache/e2e-config.json" <<PY
import json, sys
local = json.load(open("cache/local-robinhood.json"))
u = local["uniswap"]
cfg = {
  "multisig": "$MULTISIG", "keeper": "$KEEPER", "timelockDelay": 172800,
  "owner": "0x0000000000000000000000000000000000000000",
  "guardian": "0x0000000000000000000000000000000000000000",
  "treasury": "$TREASURY", "stockDrip": "0x0000000000000000000000000000000000000000",
  "factory": "0x0000000000000000000000000000000000000000",
  "oracle": "0x0000000000000000000000000000000000000000",
  "uniswap": {"swapRouter": u["swapRouter"], "legacyRouter": False, "weth": u["weth"], "usdg": u["usdg"],
              "v3Factory": u["v3Factory"], "positionManager": u["positionManager"], "quoterV2": u["quoterV2"]},
  "stockTokens": [{"ticker": "AAPL", "address": local["stockTokens"][0]["address"], "depositCap": 0,
                   "maturities": [1806019200]}],
}
json.dump(cfg, open(sys.argv[1], "w"), indent=2)
PY
DRIPP_CONFIG=cache/e2e-config.json DRIPP_DEPLOYMENT_OUT=cache/e2e-deployment.json \
  forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast --slow --private-key "$DEPLOYER_KEY" > "$WORK/deploy.log" 2>&1
export DRIPP_DEPLOYMENT="$ROOT/contracts/cache/e2e-deployment.json"
cat "$DRIPP_DEPLOYMENT"; echo

log "Seed phase 1 (pools, splits, zaps, 1% dividend, split announcement)"
SEED_PHASE=1 forge script test/e2e/Seed.s.sol --rpc-url "$RPC" --broadcast --slow > "$WORK/seed1.log" 2>&1

if [[ "${E2E_STAGE:-all}" == "chain" ]]; then E2E_KEEP=1; exit 0; fi

log "Indexer (Ponder)"
cd "$ROOT/indexer"
PONDER_RPC_URL="$RPC" PONDER_CACHE_RPC=false setsid npx ponder start --schema dripp_indexer --views-schema dripp --port 42069 > "$WORK/ponder.log" 2>&1 &
PIDS+=($!)
wait_http http://127.0.0.1:42069/ready 120

export RPC_URL="$RPC"
psql_q() { psql "$DATABASE_URL" -tAc "$1"; }
wait_sql() { # sql, expected, seconds
  for _ in $(seq 1 "$3"); do [[ "$(psql_q "$1" 2>/dev/null)" == "$2" ]] && return 0; sleep 1; done
  echo "timeout waiting for: $1 = $2 (got $(psql_q "$1"))" >&2; return 1
}
keeper() { (cd "$ROOT/backend" && KEEPER_PRIVATE_KEY="$KEEPER_KEY" npx tsx src/keeper/main.ts --once); }
keeper_expect() { # action prefix, e.g. propose / confirm
  local out; out=$(keeper); echo "$out"
  grep -q "\"$1:" <<<"$out" || { echo "keeper did not $1" >&2; exit 1; }
}
warp() { cast rpc evm_increaseTime "$1" --rpc-url "$RPC" >/dev/null && cast rpc evm_mine --rpc-url "$RPC" >/dev/null; }

log "Keeper: propose the 1% dividend, wait out the dispute window, confirm"
(cd "$ROOT/backend" && npx tsx src/migrate.ts)
keeper_expect propose
warp 86401
keeper_expect confirm

log "Seed phase 2 (claim, merge)"
cd "$ROOT/contracts"
SEED_PHASE=2 forge script test/e2e/Seed.s.sol --rpc-url "$RPC" --broadcast --slow > "$WORK/seed2.log" 2>&1

VAULT=$(python3 -c "import json; print(json.load(open('$DRIPP_DEPLOYMENT'))['factory'])")
VAULT=$(cast call "$VAULT" "allVaults(uint256)(address)" 0 --rpc-url "$RPC")
BOB=0x976EA74026E726554dB657fA54763abd0C3a0aa9
export E2E_BOB_CLAIMABLE_BEFORE_SPLIT=$(cast call "$VAULT" "claimableYield(address)(uint256)" "$BOB" --rpc-url "$RPC" | awk '{print $1}')
echo "bob claimable before split: $E2E_BOB_CLAIMABLE_BEFORE_SPLIT"

log "2:1 split becomes effective; keeper proposes it as a split and confirms"
warp $((7 * 86400))
keeper_expect propose
warp 86401
keeper_expect confirm

log "Seed phase 3 (next dividend announced on-chain)"
SEED_PHASE=3 forge script test/e2e/Seed.s.sol --rpc-url "$RPC" --broadcast --slow > "$WORK/seed3.log" 2>&1

log "Wait for the indexer"
wait_sql "select count(*) from dripp.proposal where status='confirmed'" 2 60
wait_sql "select count(*) from dripp.multiplier_update" 3 60
wait_sql "select count(*) from dripp.vault_action where kind='claim'" 1 60

log "API"
cd "$ROOT/backend"
export PORT=8787 ADMIN_API_KEY=test COMMENT_BANNED_WORDS=scam PRICE_POLL_MS=2000 EVENT_POLL_MS=1000
curl -sf http://127.0.0.1:8787/health >/dev/null && { echo "port 8787 is busy; stop the old API first" >&2; exit 1; }
setsid npx tsx src/server.ts > "$WORK/api.log" 2>&1 &
PIDS+=($!)
wait_http http://127.0.0.1:8787/health 30

log "E2E tests"
API_URL=http://127.0.0.1:8787 npx vitest run test/e2e.test.ts

if [[ "${E2E_UI:-0}" == "1" ]]; then
  log "Web app (Next.js) + Playwright UI tests"
  cd "$ROOT/web"
  export NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_API_URL=http://127.0.0.1:8787 NEXT_PUBLIC_CHAIN_ID=31337 NEXT_PUBLIC_RPC_URL="$RPC"
  npx next build > "$WORK/web-build.log" 2>&1
  curl -sf http://127.0.0.1:3000 >/dev/null && { echo "port 3000 is busy; stop the old web server first" >&2; exit 1; }
  setsid npx next start -p 3000 > "$WORK/web.log" 2>&1 &
  PIDS+=($!)
  wait_http http://127.0.0.1:3000 60
  mkdir -p "$WORK/screens"
  # CHROMIUM_PATH: optional browser binary (e.g. a preinstalled Chromium); otherwise Playwright's own.
  npx playwright test
fi
