# Dripp

Yield-stripping untuk Stock Token ERC-8056: setor saham ter-tokenisasi, pecah menjadi
**PT** (pokok, ditebus saat jatuh tempo) dan **YT** (hasil dari kenaikan `uiMultiplier`).

| Folder       | Isi                                                        | Status            |
|--------------|------------------------------------------------------------|-------------------|
| `contracts/` | Smart contract (Foundry + OpenZeppelin)                    | Diimplementasikan |
| `indexer/`   | Indexer event on-chain (Split, Merge, RedeemPT, YieldClaimed…) | Placeholder     |
| `backend/`   | API untuk web & bot                                        | Placeholder       |
| `web/`       | Frontend dApp                                              | Placeholder       |
| `bot/`       | Keeper (mis. memanggil `updateIndex()` tepat saat jatuh tempo) | Placeholder     |

Lihat [`contracts/README.md`](contracts/README.md) untuk detail kontrak.
