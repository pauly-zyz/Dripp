# Dripp contracts

Foundry + OpenZeppelin v5.4.0, Solidity 0.8.28.

```sh
git submodule update --init --recursive
forge build --sizes
forge test            # unit, fuzz, invariant
```

## Kontrak

| Kontrak              | Fungsi |
|----------------------|--------|
| `DrippVaultFactory`  | Registry seri. Allowlist Stock Token (wajib ERC-8056 via ERC-165) beserta ticker-nya, buat satu `DrippVault` per (saham, jatuh tempo), atur deposit cap, pause/unpause, `treasury`, `guardian`. |
| `DrippVaultDeployer` | Menyimpan bytecode `DrippVault` agar factory tetap di bawah batas 24 KB. |
| `DrippVault`         | `split`, `merge`, `redeemPT`, `claimYield`, `updateIndex`; akuntansi akrual YT. Pausable, ReentrancyGuard. |
| `PTToken`            | ERC-20 + permit (mis. `pAAPL-MAR27`). Mint/burn hanya oleh vault. |
| `YTToken`            | ERC-20 + permit (mis. `yAAPL-MAR27`). Setiap perubahan saldo memanggil `vault.onYTBalanceChange(from, to)` untuk checkpoint akrual. |

Nama seri = `<TICKER>-<BULAN><TAHUN>` dari tanggal jatuh tempo (UTC), mis. `AAPL-MAR27`.
Cari vault lewat `factory.getVault(stock, maturity)` atau `factory.getVaultBySeries("AAPL-MAR27")`.

## Cara kerja

Satuan PT/YT = **saham** = *UI amount* Stock Token: `raw * index / 1e18`, dengan `index` = high-water mark
dari `uiMultiplier()` (ERC-8056, 18 desimal). 1 PT + 1 YT = 1 saham.

- **split(raw)** pada indeks `I` → mint `raw·I/1e18` PT **dan** YT.
- **merge(a)** kapan saja → bakar `a` PT + `a` YT, terima `a·1e18/I` token mentah. Setelah jatuh tempo
  hasilnya sama dengan `redeemPT`.
- **YT** yang memegang `a` saat indeks naik `I0 → I1` mendapat `a·1e18/I0 − a·1e18/I1` token mentah,
  bisa diklaim kapan saja (`claimYield`).
- **High-water mark**: jika `uiMultiplier` turun, indeks tidak ikut turun; kenaikan kembali ke puncak lama
  tidak dihitung dua kali. Penurunan ditanggung PT, vault tidak pernah defisit.
- **Checkpoint saat transfer YT**: yield sebelum transfer tetap milik pengirim; penerima mulai dari indeks saat itu.
- **Jatuh tempo**: indeks YT dibekukan pada interaksi pertama di/setelah `maturity` (keeper sebaiknya
  memanggil `updateIndex()` tepat waktu). `redeemPT(a)` → `a·1e18/I_live` token mentah; selisih terhadap
  basis saat jatuh tempo (yield pasca-jatuh-tempo) dikirim ke `treasury`.
- Pembulatan selalu ke bawah (menguntungkan vault).

> **Belum ada:** pembeda dividen vs stock split. Saat ini *setiap* kenaikan `uiMultiplier` dihitung
> sebagai dividen untuk YT. `DividendOracle` (masa sanggah 24 jam) dan fee 5% klaim YT dikerjakan di
> Prompt 2 SPEC.md. Jangan deploy ke mainnet sebelum itu.

## Keamanan

- **Owner** factory = `TimelockController` (default 48 jam) dengan multisig sebagai proposer/executor:
  allowlist saham, buat seri, ubah deposit cap, treasury, guardian, unpause.
- **Guardian** (default = multisig, tanpa timelock): bisa `pauseVault` seketika. Unpause hanya lewat owner.
  Saat pause, `split`/`merge`/`redeemPT`/`claimYield` berhenti; transfer PT/YT tetap jalan (dengan checkpoint).
- **Deposit cap** per vault, dalam saham (PT beredar maksimum). `UNCAPPED` = tanpa batas.

## Invariant (`test/invariant/`)

- **PT + YT = saham tersimpan**: `saldo vault ≥ nilai PT (token mentah) + yield YT terutang`, selisih hanya debu pembulatan.
- Konservasi: saldo vault = total disetor − total dibayar.
- Sebelum jatuh tempo `totalSupply(PT) == totalSupply(YT)`.
- Indeks tidak pernah turun; `totalAccruedYield` = jumlah akrual per-user; indeks jatuh tempo ≤ indeks live.

## Konfigurasi alamat Stock Token

Salin `config/example.json` → `config/<network>.json` lalu isi:

| Field           | Arti |
|-----------------|------|
| `multisig`      | Multisig admin. Proposer/executor timelock dan guardian default. |
| `timelockDelay` | Detik, default `172800` (48 jam). |
| `owner`         | Owner akhir factory. `0x0` → deploy `TimelockController` baru untuk `multisig`. |
| `guardian`      | Boleh pause. `0x0` → `multisig`. |
| `treasury`      | Penerima yield pasca-jatuh-tempo (dan fee nanti). |
| `factory`       | Factory yang sudah ada (broadcaster harus owner-nya), atau `0x0` untuk deploy baru. |
| `stockTokens[]` | `ticker` (mis. `AAPL`), `address` Stock Token, `depositCap` dalam saham utuh (`0` = tanpa batas), `maturities` (unix detik, UTC). |

```sh
DRIPP_CONFIG=config/<network>.json forge script script/Deploy.s.sol \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
```

Script menolak jalan jika alamat wajib masih `0x000…`. Setelah setup, kepemilikan factory langsung
dipindah ke owner akhir (timelock), jadi seri baru berikutnya harus lewat multisig + timelock.
