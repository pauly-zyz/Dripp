# indexer

Indexer [Ponder](https://ponder.sh) 0.18 untuk semua event Dripp dan pool PT/YT di Uniswap v3. Data ditulis ke
PostgreSQL dan dibaca oleh `backend/` lewat *views schema* (`dripp`).

```sh
cp .env.example .env.local   # isi PONDER_RPC_URL, DATABASE_URL, DRIPP_DEPLOYMENT
pnpm --filter @dripp/indexer dev      # dev: hot reload, pglite jika DATABASE_URL kosong
pnpm --filter @dripp/indexer start    # produksi: ponder start --views-schema dripp
```

Alamat dan blok awal diambil dari `contracts/deployments/<chainId>.json` (ditulis `script/Deploy.s.sol`).

## Sumber event

| Kontrak | Event | Tabel |
|---------|-------|-------|
| `DrippVaultFactory` | `SeriesCreated`, `StockTokenAllowed`, `FeesUpdated`, `TreasuryUpdated`, `StockDripUpdated`, `GuardianUpdated` | `series`, `dripp_token`, `stock_token`, `protocol` |
| `DrippVault` (factory) | `Split`, `Merge`, `Redeem`, `YieldClaimed`, `PostMaturityYieldToTreasury`, `IndexUpdated`, `MaturityIndexSet`, `DepositCapUpdated`, `Paused`, `Unpaused` | `vault_action`, `series`, `trader_series` |
| `PTToken` / `YTToken` (factory) | `Transfer` | `holder`, supply di `series`, dan swap pool (lihat bawah) |
| `DividendOracle` | `TokenRegistered`, `DividendProposed`, `DividendDisputed`, `DividendConfirmed` | `stock_token`, `proposal` |
| Stock Token (factory dari `TokenRegistered`) | `UIMultiplierUpdated`, `UIMultiplierUpdateCancelled` (ERC-8056) | `multiplier_update` (jadwal ex-dividen on-chain) |
| Uniswap v3 Factory | `PoolCreated` (hanya pool PT/saham dan YT/saham seri yang sama) | `pool` |
| `DrippRouter` | `Zapped` | `zap`, `trader_series` |

**Swap pool PT/YT** tanpa meng-index semua pool di chain: setiap `Transfer` PT/YT yang masuk/keluar dari pool
yang dikenal memicu pembacaan receipt transaksi itu, lalu log `Swap` pool tersebut didekode ke tabel `swap`
(harga `sqrtPriceX96`, delta token dan saham, trader = pengirim transaksi). Statistik volume per trader ada di
`trader_series`.

Semua jumlah disimpan mentah (bigint): saham mentah = wei Stock Token, PT/YT = share seri (18 desimal),
multiplier/indeks/rasio 18 desimal. Nama kolom Postgres = snake_case dari nama properti.

`GET /graphql` dan `/sql/*` (Ponder) tersedia untuk debugging; API publik ada di `backend/`.
