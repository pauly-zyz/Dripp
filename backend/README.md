# backend

API Node.js TypeScript (Hono) di atas PostgreSQL (tabel indexer Ponder + tabel milik backend) dan Redis, plus
**keeper** `DividendOracle`.

```sh
cp .env.example .env    # lalu export, atau pakai direnv
pnpm --filter @dripp/backend start     # API + WebSocket (menjalankan migrasi dripp_app saat start)
pnpm --filter @dripp/backend keeper    # keeper (loop); tambah -- --once untuk satu putaran
pnpm --filter @dripp/backend test      # unit test
bash ../scripts/e2e-local.sh           # end-to-end: anvil + kontrak + Ponder + keeper + API
```

Butuh indexer yang berjalan dengan `--views-schema` = `PONDER_VIEWS_SCHEMA` (default `dripp`) di database yang
sama. Tanpa `REDIS_URL` cache dan rate limit memakai memori proses.

## Endpoint

| Method | Path | Isi |
|--------|------|-----|
| GET | `/markets?stock=AAPL&maturity=MAR27&status=active` | Daftar seri: harga PT/YT (dalam saham mentah, share, USD), imbal hasil tetap tersirat, dividen tersirat, dividen terealisasi, TVL, volume 24 jam, pool, skor risiko |
| GET | `/markets/:series` | Seri (nama `AAPL-MAR27` atau alamat vault) + riwayat dividen/split oracle, 50 swap terakhir, riwayat harga PT/YT |
| GET/POST | `/markets/:series/comments` | Komentar; POST butuh tanda tangan wallet (lihat bawah) |
| GET | `/calendar?stock=AAPL&from=&to=` | Kalender ex-dividen (lihat bawah). `from`/`to`: ISO atau unix, default −90 hari … +180 hari |
| GET | `/users/:address/portfolio` | Posisi PT/YT + nilai, YT yang bisa diklaim, pengingat jatuh tempo, aktivitas |
| GET | `/users/:address/claimable` | Dividen YT per seri: gross, fee 5%, net (dibaca on-chain `claimableYield`) |
| GET | `/oracle/proposals?status=pending&stock=` | Usulan oracle, sisa masa sanggah, `confirmable` |
| GET | `/leaderboard?metric=points\|volume\|yield` | Peringkat trader |
| GET | `/referrals/:address`, POST `/referrals` | Info referral; daftar referral dengan tanda tangan referee |
| WS | `/ws` | `{"type":"subscribe","channels":["prices","dividends"]}` → `prices` (snapshot saat subscribe, lalu perubahan), `dividend` (`proposed`/`confirmed`/`disputed`/`scheduled`) |
| POST | `/admin/corporate-actions` | (header `x-admin-key`) umumkan dividen/split: `{stockToken, kind, exDate, ratio?: "2:1", amountUsd?, note?}` |
| DELETE | `/admin/comments/:id`, POST `/admin/bans` | Moderasi |

Semua jumlah on-chain dikembalikan sebagai string integer mentah; harga/yield sebagai angka desimal.

### Harga dan imbal hasil

Satuan *share* = satuan seri (1 PT + 1 YT = 1 share; 1 token saham mentah = `index` share).

- Harga PT/YT dari `slot0` pool Uniswap v3 (pool terdalam jika ada beberapa fee tier), dikonversi ke share:
  `harga_share = harga_dalam_saham_mentah × index`.
- **Imbal hasil tetap tersirat** (`impliedFixedApy`) = `(1 / harga_PT)^(1 tahun / sisa waktu) − 1`.
- **Dividen tersirat** (`impliedDividendApy`) = rumus yang sama dengan `harga_PT = 1 − harga_YT`.
- **Dividen terealisasi** (`realizedDividendApy`) = pertumbuhan dividend index oracle selama ≤ 1 tahun terakhir,
  disetahunkan (minimal 90 hari data).
- USD hanya jika `feed` Chainlink diisi untuk saham itu di config/deployment.

### Skor risiko (0 = paling aman, 100 = paling berisiko)

| Komponen | Bobot | Aturan |
|----------|-------|--------|
| Likuiditas pool PT+YT | 40 | 0 jika nilai pool ≥ 50% TVL seri, naik linear sampai 40 tanpa likuiditas |
| Waktu ke jatuh tempo | 20 | linear sampai 2 tahun |
| Oracle | 25 | +12 jika ada usulan dalam masa sanggah, +8 per sanggahan 30 hari terakhir |
| Konsentrasi pemegang | 15 | porsi 5 pemegang terbesar PT/YT (tanpa pool & vault): 20% → 0, 80% → 15 |

Level: `< 30` low, `< 60` medium, selainnya high. Implementasi: `shared/src/risk.ts`.

### Kalender ex-dividen

Digabung dari:
- `scheduled`: pengumuman ERC-8056 `UIMultiplierUpdated` dengan `effectiveAt` di masa depan (on-chain);
- `announced`: aksi korporasi yang dimasukkan tim lewat `/admin/corporate-actions`;
- `proposed` / `confirmed` / `disputed`: usulan `DividendOracle` (persentase dividen dari dividend index, rasio split).

### Komentar

Pesan yang ditandatangani (EIP-191; ERC-1271 untuk smart wallet):

```
Dripp comment
Series: AAPL-MAR27
Timestamp: <unix detik>

<isi>
```

`POST {author, body, timestamp, signature}`. Timestamp maks ±5 menit. Rate limit per wallet: 1 per 30 detik dan
30 per hari. Moderasi: panjang ≤ 500, kata terlarang (`COMMENT_BANNED_WORDS`), maks 1 tautan, wallet bisa
di-ban dan komentar disembunyikan oleh admin.

### Referral dan poin

Referee menandatangani `Dripp referral\nReferrer: <referrer>\nReferee: <referee>` (alamat huruf kecil) dan
`POST /referrals {referee, referrer, signature}`. Sekali per wallet, tidak bisa melingkar.

Poin (sementara, sebelum job poin harian di fase 3): 1 per share volume swap PT/YT + 10 per share dividen YT yang
diklaim + 0,1 per share split + 1 per zap; referrer mendapat tambahan 10% poin referee-nya.

## Keeper

`src/keeper/` memantau `uiMultiplier()` setiap Stock Token yang terdaftar di oracle. Setiap putaran, per token:

1. ada usulan yang masa sanggahnya lewat → `confirm(token)`;
2. jika tidak, `needsProposal(token)` → klasifikasi `confirmedMultiplier → uiMultiplier`:
   - pengumuman tim (`/admin/corporate-actions`, ex-date −14 … +2 hari) didahulukan;
   - jika tidak ada: rasio "rapi" persis (2:1, 3:2, 1:10, …) = split; naik < 15% = dividen; split rapi × naik < 5% = campuran;
   - selain itu **ambigu**: tidak diusulkan, kirim alert (`ALERT_WEBHOOK_URL`) agar multisig menangani manual.
3. kirim `proposeDividend` / `proposeSplit` / `propose(token, splitRatio)` (simulasi dulu, tunggu receipt).

Tanpa `KEEPER_PRIVATE_KEY` keeper berjalan *dry run* (hanya log). Alamat keeper butuh `PROPOSER_ROLE` di oracle
(diberikan oleh `Deploy.s.sol` dari field `keeper` di config).

Belum ada (fase berikutnya SPEC): `harvestAndDrip` untuk `DrippStaking`, eksekusi limit order, poin harian.
