# Dripp — Spesifikasi MVP

Oct 19, 2026 · @choky

## Ringkasan

Dripp adalah lapisan dividen untuk saham ter-tokenisasi di Robinhood Chain, mengikuti model Fletch: satu saham dipecah menjadi PT (pokok) dan YT (dividen) yang bisa diperdagangkan terpisah. Token platform $DRIPP diluncurkan lewat Pons V2.

**Tagline:** Split the stock. Trade the drip.

**Masalah yang dipecahkan:** Stock Token Robinhood tidak membayar dividen tunai; dividen diinvestasikan ulang dan tercermin lewat kenaikan multiplier token. Dividen jadi tidak terlihat dan tidak punya harga sendiri. Dripp memberinya harga dan pasar.

**Untuk siapa:**

- Pencari pendapatan tetap: beli PT, dapat imbal hasil tetap sampai jatuh tempo.
- Spekulan dividen: beli YT, eksposur dividen dengan modal kecil (leverage).
- Pemegang saham: split untuk menjual dividen masa depan atau melindungi nilai (hedge).
- Holder $DRIPP: menerima Stock Drip, yaitu reward saham dari pendapatan protokol.

**Pesaing yang sudah ada:** Fletch, hdfi, dan PARE sama-sama memecah Stock Token menjadi PT/YT. Dripp harus menang lewat UX yang jauh lebih sederhana, Stock Drip untuk holder $DRIPP, basket/indeks PT-YT, dan alat trading (leaderboard, bot, referral).

## Cara kerja inti

Satu PT ditambah satu YT dengan jatuh tempo sama selalu setara satu saham; dividen sebelum jatuh tempo mengalir ke YT.

**Dasar teknis:** dividen dan stock split pada Stock Token dicatat lewat multiplier on-chain (ERC-8056). Saldo mentah tidak berubah saat aksi korporasi; yang naik hanya multiplier, dan jumlah saham = saldo mentah × multiplier.

1. **Deposit & split** — pengguna menyetor Stock Token (mis. AAPL) ke vault seri tertentu (mis. AAPL-MAR27) dan menerima PT dan YT dalam jumlah sama.
2. **Akrual** — vault mencatat multiplier saat deposit; kenaikan multiplier akibat dividen menjadi hak pemegang YT.
3. **Klaim YT** — pemegang YT bisa mengklaim dividen yang terakumulasi kapan saja, dalam bentuk saham.
4. **Merge** — PT + YT bisa digabung kembali menjadi saham kapan saja, gratis.
5. **Jatuh tempo** — PT ditebus menjadi saham dasar; YT berhenti mengakrual.

**Pembeda split vs dividen:** kenaikan multiplier karena stock split tidak boleh dihitung sebagai dividen. Dripp memakai oracle dividen dengan masa sanggah 24 jam (seperti Fletch) sebelum kenaikan multiplier diakui sebagai dividen.

**Pasar:** setiap seri punya dua pool di Uniswap Robinhood Chain: PT/saham dan YT/saham. Harga PT menyiratkan imbal hasil tetap; harga YT menyiratkan ekspektasi dividen.

## Fitur MVP

Fitur yang disepakati sebelumnya dipertahankan, tetapi disesuaikan dari konteks launchpad ke konteks lapisan dividen.

| Fitur | Dari saran awal | Bentuk di Dripp |
| --- | --- | --- |
| Split, merge, redeem PT/YT | Fondasi (dari Fletch) | Vault per seri saham dan jatuh tempo |
| Stock Drip | Holder reward dalam saham | Pendapatan protokol dibelikan saham dan dibagikan ke staker $DRIPP |
| Basket PT/YT | Meme index | Vault indeks (mis. MAG3: AAPL, NVDA, TSLA) dipecah jadi PT/YT indeks |
| Keamanan transparan | Keamanan (tanpa anti-sniper) | Oracle dividen + masa sanggah 24 jam, batas deposit per vault saat peluncuran, admin multisig + timelock, halaman bukti cadangan |
| Pengalaman trading | Pengalaman trading | UI sederhana, mode Fixed Income (beli PT sekali klik), zap dari ETH/USDG, kalender ex-dividen, PnL, limit order |
| Sosial & pertumbuhan | Sosial & pertumbuhan | Leaderboard yield trader, referral bagi fee, poin |
| Bot Telegram | Pengalaman trading | Beli PT/YT, cek imbal hasil, notifikasi dividen dan jatuh tempo |
| Yield-stream token (fase 2) | Creator fee token | Aliran fee protokol per vault ditokenisasi dan bisa diperdagangkan |
| Skor risiko per seri | Skor risiko | Skor 0–100 dari kedalaman likuiditas pool PT/YT, waktu menuju jatuh tempo, dan status oracle dividen |
| Bukti LP terkunci | Bukti LP terkunci | Alamat pool dan tx hash LP $DRIPP yang terkunci dari graduasi Pons V2, ditampilkan di halaman Transparansi |
| Vesting tim | Vesting kreator | Alokasi tim $DRIPP dikunci di kontrak vesting (cliff + linear), jadwal terlihat publik |
| Komentar per seri | Komentar/live chat | Diskusi di halaman Detail seri, hanya untuk wallet terhubung |

**Prioritas MVP:** split/merge/redeem, oracle dividen, mode Fixed Income, zap, kalender ex-dividen, dan Stock Drip untuk staker $DRIPP.

## Token $DRIPP dan peluncuran di Pons V2

$DRIPP diluncurkan lewat Pons V2, sehingga distribusi awal mengikuti bonding curve ETH Pons lalu graduasi ke pool Uniswap V4 terkunci. Dripp tidak menulis kontrak token sendiri.

**Konsekuensi:** kontrak token dibuat oleh Pons dengan supply tetap, jadi utilitas $DRIPP harus ditambahkan lewat kontrak terpisah milik Dripp (staking), bukan lewat pajak transfer.

**Utilitas $DRIPP:**

- **Stake → Stock Drip:** staker $DRIPP menerima bagian pendapatan protokol dalam bentuk saham ter-tokenisasi.
- **Diskon fee:** staker di atas ambang tertentu mendapat potongan fee redeem YT.
- **Boost poin:** staker mendapat pengali poin di leaderboard.
- **Governance ringan (fase lanjut):** memilih saham untuk vault baru.

**Langkah peluncuran:**

1. Bangun dan uji protokol inti di testnet terlebih dulu, supaya token punya produk nyata saat diluncurkan.
2. Siapkan nama, ticker DRIPP, logo, deskripsi, dan tautan sosial untuk halaman Pons.
3. Luncurkan di Pons V2; dev-buy (jika ada) diumumkan terbuka.
4. Setelah graduasi, catat alamat token dan pool, lalu hubungkan ke kontrak `DrippStaking`.
5. Aktifkan Stock Drip setelah protokol menghasilkan pendapatan.

**Transparansi token:** alokasi tim $DRIPP dikunci di `DrippVesting` (mis. cliff 3 bulan, linear 12 bulan), dan bukti LP terkunci dari graduasi Pons (alamat pool + tx hash) ditampilkan di halaman Transparansi.

**Pertanyaan terbuka:** apakah Pons membagi fee kreator ke peluncur token; jika ya, fee itu bisa ikut masuk ke Stock Drip. Perlu dicek di dokumentasi Pons.

## Smart contract

MVP membutuhkan tujuh kontrak (Solidity 0.8.x, Foundry, OpenZeppelin); angka fee adalah nilai awal yang bisa diubah lewat multisig + timelock.

| Kontrak | Tanggung jawab |
| --- | --- |
| `DrippVaultFactory` | Membuat vault per pasangan (saham, jatuh tempo); registry seri |
| `DrippVault` | Deposit/split, merge, redeem PT saat jatuh tempo, akrual dan klaim YT berdasarkan multiplier ERC-8056 |
| `PTToken` / `YTToken` | ERC-20 untuk tiap seri (mis. pAAPL-MAR27, yAAPL-MAR27); mint/burn hanya oleh vault |
| `DividendOracle` | Mengusulkan kenaikan multiplier sebagai dividen atau split; masa sanggah 24 jam; dapat disanggah multisig |
| `DrippRouter` | Zap ETH/USDG → saham → PT atau YT dalam satu transaksi via Uniswap; proteksi slippage |
| `DrippStaking` | Stake $DRIPP, akumulator `rewardPerShare`, `harvestAndDrip()` menukar pendapatan ke saham, `claim()` |
| `DrippVesting` | Mengunci alokasi tim $DRIPP dengan cliff + rilis linear; fungsi release() dan jadwal yang bisa dibaca publik |

### Akuntansi YT

- Vault menyimpan multiplier high-water mark per seri.
- Saat multiplier naik dan oracle mengonfirmasi dividen, selisih saham dialokasikan ke akumulator YT.
- Pemegang YT mengklaim proporsional; transfer YT memicu checkpoint akrual agar tidak bisa dicurangi.
- Kenaikan karena split menyesuaikan rasio tanpa menambah hak YT.

### Fee

| Jenis | Besaran awal | Tujuan |
| --- | --- | --- |
| Fee klaim/redeem YT | 5% dari dividen | 60% Stock Drip staker $DRIPP, 40% treasury |
| Fee split/merge | 0% | — |
| Fee redeem PT | 0% | — |
| Fee zap router | 0,1% | 60% Stock Drip, 40% treasury |

### Keamanan

- Batas total deposit per vault di awal peluncuran (dinaikkan bertahap).
- ReentrancyGuard, checks-effects-interactions, Pausable, admin multisig + timelock 48 jam.
- Uji fuzz/invariant: PT + YT selalu = saham tersimpan; tidak ada YT yang mengakrual dari split.
- Audit eksternal wajib sebelum mainnet.

## Frontend

Frontend memakai Next.js, TypeScript, Tailwind, wagmi + viem, dan RainbowKit, dengan gaya sederhana ala aplikasi Robinhood, mobile-first, tema gelap.

| Halaman | Fitur utama |
| --- | --- |
| Markets (`/`) | Daftar seri per saham: harga PT, imbal hasil tetap tersirat, harga YT, dividen tersirat, TVL, jatuh tempo; filter per saham dan jatuh tempo |
| Fixed Income (`/earn`) | Pilih saham + jatuh tempo, lihat imbal hasil tetap, beli PT sekali klik dari ETH/USDG (zap) |
| Detail seri (`/market/[series]`) | Panel split/merge/redeem, beli/jual PT dan YT, chart imbal hasil, riwayat dividen, kalender ex-dividen, skor risiko seri, komentar |
| Basket (`/baskets`) | Vault indeks dan PT/YT indeks |
| Portofolio (`/portfolio`) | Posisi PT/YT, PnL, dividen YT yang bisa diklaim, Claim All, pengingat jatuh tempo |
| Stake (`/stake`) | Stake/unstake $DRIPP, Stock Drip yang terkumpul, klaim reward saham |
| Transparansi (`/transparency`) | Status oracle dividen, usulan dalam masa sanggah, cadangan per vault, alamat kontrak, bukti LP $DRIPP terkunci, jadwal vesting tim |
| Leaderboard (`/leaderboard`) | Yield trader teratas, poin, referral |

**Fitur lintas halaman:** koneksi wallet dengan Robinhood Chain sebagai jaringan default, notifikasi dividen dan jatuh tempo, link referral, tooltip edukasi PT/YT untuk pemula.

## Backend, indexer, dan bot Telegram

Backend (Node.js TypeScript, PostgreSQL, Redis) menyajikan data turunan dan menjalankan keeper; indexer memakai Ponder.

**Indexer** — event `SeriesCreated`, `Split`, `Merge`, `Redeem`, `YieldClaimed`, `DividendProposed`, `DividendConfirmed`, `Staked`, `Harvested`; serta swap pool PT/YT di Uniswap.

**API:**

- `GET /markets` dan `/markets/:series`: harga PT/YT, imbal hasil tetap tersirat, dividen tersirat, TVL.
- `GET /calendar`: jadwal ex-dividen per saham.
- `GET /users/:address/portfolio`, `/claimable`.
- `GET /oracle/proposals`, `/leaderboard`, `/referrals/:address`.
- WebSocket untuk harga dan event dividen.

**Skor risiko seri** (0–100): dihitung dari kedalaman likuiditas pool PT/YT, waktu menuju jatuh tempo, usulan oracle yang sedang dalam masa sanggah, dan konsentrasi pemegang. Disajikan di `GET /markets/:series`.

**Komentar:** `GET/POST /markets/:series/comments`, tanda tangan wallet untuk posting, batas laju (rate limit) per wallet, dan moderasi dasar.

**Keeper jobs:**

- Memantau `uiMultiplier()` tiap Stock Token dan mengusulkan dividen/split ke `DividendOracle`.
- `harvestAndDrip` di `DrippStaking` saat pendapatan melewati ambang.
- Eksekusi limit order dan perhitungan poin harian.

**Bot Telegram:** `/earn <saham>` (imbal hasil tetap terbaik), `/buy pt|yt <seri> <jumlah>`, `/portfolio`, `/claim`, serta notifikasi dividen, jatuh tempo, dan Stock Drip.

## Fase pengembangan

Protokol dibangun dan diuji dulu; $DRIPP diluncurkan di Pons V2 setelah ada produk yang bisa dicoba.

**Fase 1 — Protokol inti (testnet)**

- [ ] Monorepo (contracts, indexer, backend, web, bot)
- [ ] `DrippVaultFactory`, `DrippVault`, `PTToken`/`YTToken` + test invariant
- [ ] `DividendOracle` dengan masa sanggah 24 jam
- [ ] Uji fork Robinhood Chain dengan Stock Token nyata

**Fase 2 — Aplikasi**

- [ ] `DrippRouter` (zap) dan pool PT/saham, YT/saham
- [ ] Indexer, API, keeper multiplier
- [ ] Halaman Markets, Fixed Income, Detail seri (skor risiko, komentar), Portofolio, Transparansi

**Fase 3 — Token dan pertumbuhan**

- [ ] Luncurkan $DRIPP di Pons V2, kunci alokasi tim di DrippVesting, tampilkan bukti LP terkunci
- [ ] `DrippStaking` + Stock Drip, halaman Stake
- [ ] Leaderboard, referral, poin, bot Telegram

**Fase 4 — Mainnet dan lanjutan**

- [ ] Audit eksternal dan perbaikan
- [ ] Mainnet dengan multisig + timelock, batas deposit bertahap
- [ ] Basket PT/YT dan yield-stream token

## Prompt untuk Claude Code

Ekspor dokumen ini sebagai Markdown, simpan sebagai `SPEC.md` di root repo, lalu jalankan prompt berikut berurutan.

**Prompt 1 — Protokol inti**

```
Baca SPEC.md. Buat monorepo: contracts/, indexer/, backend/, web/, bot/.
Di contracts/, setup Foundry + OpenZeppelin. Implementasikan DrippVaultFactory, DrippVault,
PTToken dan YTToken sesuai bagian Cara kerja inti dan Smart contract: split, merge, redeem PT
saat jatuh tempo, akrual YT dari multiplier ERC-8056 (uiMultiplier) dengan high-water mark,
checkpoint akrual saat transfer YT. Tulis test invariant: PT + YT = saham tersimpan.
Alamat Stock Token jadikan konfigurasi yang saya isi.
```

**Prompt 2 — Oracle dan router**

```
Lanjutkan dari SPEC.md. Implementasikan DividendOracle (usulan dividen vs split, masa sanggah
24 jam, sanggahan oleh multisig) dan hubungkan ke DrippVault agar split tidak menambah hak YT.
Implementasikan DrippRouter untuk zap ETH/USDG ke PT atau YT via Uniswap dengan proteksi slippage.
Terapkan fee sesuai tabel Fee. Uji dengan fork Robinhood Chain.
```

**Prompt 3 — Indexer, backend, keeper**

```
Berdasarkan SPEC.md bagian Backend, buat indexer Ponder untuk semua event Dripp dan pool PT/YT,
backend TypeScript + PostgreSQL dengan endpoint yang tercantum (termasuk imbal hasil tersirat
dan kalender ex-dividen), serta keeper yang memantau uiMultiplier dan mengusulkan ke DividendOracle.
```

**Prompt 4 — Frontend**

```
Berdasarkan SPEC.md bagian Frontend, buat aplikasi Next.js + Tailwind + wagmi/viem + RainbowKit
dengan halaman Markets, Fixed Income, Detail seri, Portofolio, dan Transparansi. Gaya minimalis
ala aplikasi Robinhood, mobile-first, tema gelap, dengan tooltip edukasi PT/YT,
skor risiko per seri, dan komentar per seri.
```

**Prompt 5 — Token dan pertumbuhan (setelah $DRIPP live di Pons V2)**

```
Token $DRIPP sudah diluncurkan di Pons V2 di alamat <ISI_ALAMAT>. Implementasikan DrippStaking
(stake/unstake, akumulator rewardPerShare, harvestAndDrip yang menukar pendapatan protokol ke saham,
claim), DrippVesting untuk alokasi tim, bukti LP terkunci di halaman Transparansi, halaman Stake, leaderboard, referral, poin, dan bot Telegram sesuai SPEC.md.
```

## Sumber

- [Fletch — The dividend layer for Robinhood Chain](https://www.fletch.finance/)
- [Fletch Finance di Robinhood Chain explorer](https://robin.etherscan.io/token/0x3450598e419abb5609f60e4b2fda127ff0897777)
- [Ringkasan Fletch (Bitget Wallet): ERC-8056 dan masa sanggah 24 jam](https://web3.bitget.com/wallet/fletch-wallet)
- [hdfi — fixed rates on stock tokens](https://hdfi.io/)
- [PARE — docs](https://parestocks.com/docs)
- [Robinhood tokenized stocks: dividen lewat multiplier](https://eco.com/support/en/articles/15083160-robinhood-tokenized-stocks-what-s-live-and-how-it-works)
- [DefiLlama — Pons V2](https://defillama.com/protocol/pons-v2)
