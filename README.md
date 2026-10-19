# Dripp

Split the stock. Trade the drip.

Lapisan dividen untuk Stock Token ERC-8056 di Robinhood Chain: setor saham ter-tokenisasi, pecah menjadi
**PT** (pokok, ditebus saat jatuh tempo) dan **YT** (dividen dari kenaikan `uiMultiplier`).
Spesifikasi lengkap: [`SPEC.md`](SPEC.md).

| Folder       | Isi                                                          | Status            |
|--------------|--------------------------------------------------------------|-------------------|
| `contracts/` | Smart contract (Foundry + OpenZeppelin)                      | Vault, PT/YT, factory, DividendOracle, DrippRouter |
| `indexer/`   | Indexer Ponder (SeriesCreated, Split, Merge, Redeem, YieldClaimed…) | Placeholder |
| `backend/`   | API Node.js TypeScript + PostgreSQL + Redis, keeper          | Placeholder       |
| `web/`       | Next.js + wagmi/viem + RainbowKit                            | Placeholder       |
| `bot/`       | Bot Telegram                                                 | Placeholder       |

Paket TypeScript memakai pnpm workspace (`pnpm-workspace.yaml`, Node ≥ 22.12):

```sh
pnpm install
pnpm typecheck && pnpm test   # semua paket TypeScript
pnpm e2e                      # anvil + kontrak + Ponder + keeper + API, dengan assertion (butuh Postgres, Redis, Foundry)
```
Lihat [`contracts/README.md`](contracts/README.md) untuk detail kontrak dan konfigurasi alamat Stock Token.
