# Dripp contracts

Foundry + OpenZeppelin v5.4.0.

```sh
forge build
forge test            # unit, fuzz, invariant
```

## Kontrak

| Kontrak             | Fungsi |
|---------------------|--------|
| `DrippVaultFactory` | Allowlist Stock Token (wajib ERC-8056 via ERC-165), buat satu `DrippVault` per (stock token, maturity) dengan CREATE2, simpan `treasury`. |
| `DrippVault`        | `split`, `merge`, `redeemPT`, `claimYield`, `updateIndex`; akuntansi akrual YT. |
| `PTToken`           | ERC-20 + permit. Mint/burn hanya oleh vault. |
| `YTToken`           | ERC-20 + permit. Setiap perubahan saldo memanggil `vault.onYTBalanceChange(from, to)` untuk checkpoint akrual. |

## Cara kerja

Satuan PT/YT = *UI amount* Stock Token: `raw * index / 1e18`, dengan `index` = high-water mark
dari `uiMultiplier()` (ERC-8056, 18 desimal).

- **split(s)** pada indeks `I` → mint `s·I/1e18` PT **dan** YT.
- **merge(a)** (sebelum jatuh tempo) → bakar `a` PT + `a` YT, terima `a·1e18/I` saham.
- **YT** yang memegang `a` saat indeks naik `I0 → I1` mendapat `a·1e18/I0 − a·1e18/I1` saham, bisa diklaim kapan saja.
- **High-water mark**: jika `uiMultiplier` turun, indeks tidak ikut turun; kenaikan kembali ke puncak lama tidak dihitung dua kali. Penurunan ditanggung PT, vault tidak pernah defisit.
- **Checkpoint saat transfer YT**: yield sebelum transfer tetap milik pengirim; penerima mulai dari indeks saat itu.
- **Jatuh tempo**: indeks YT dibekukan pada interaksi pertama di/setelah `maturity` (keeper sebaiknya memanggil `updateIndex()` tepat waktu). `redeemPT(a)` → `a·1e18/I_live` saham; selisih terhadap basis saat jatuh tempo (yield pasca-jatuh-tempo) dikirim ke `treasury`.
- Pembulatan selalu ke bawah (menguntungkan vault).

## Invariant (`test/invariant/`)

- **PT + YT = saham tersimpan**: `saldo vault ≥ nilai PT (saham) + yield YT terutang`, dengan selisih hanya debu pembulatan.
- Konservasi saham: saldo vault = total disetor − total dibayar.
- Sebelum jatuh tempo `totalSupply(PT) == totalSupply(YT)`.
- Indeks tidak pernah turun; `totalAccruedYield` = jumlah akrual per-user; indeks jatuh tempo ≤ indeks live.

## Konfigurasi alamat Stock Token

Salin `config/example.json` → `config/<network>.json`, isi `treasury`, `owner` (0x0 = broadcaster),
`factory` (0x0 = deploy baru), dan daftar `stockTokens` (`symbol`, `address`, `maturities` dalam unix detik).

```sh
DRIPP_CONFIG=config/<network>.json forge script script/Deploy.s.sol \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
```

Script menolak jalan jika masih ada alamat `0x000…`.
