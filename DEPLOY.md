# Deploy Dripp (Robinhood Chain)

Semua langkah di bawah sudah diuji ujung-ke-ujung pada chain lokal: stack Docker ini (Postgres, Redis, indexer,
API, keeper, web, Caddy HTTPS) lulus test UI Playwright yang sama dengan pengembangan lokal (beli PT, klaim
dividen, komentar bertanda tangan).

## 1. Kontrak

Butuh [Foundry](https://getfoundry.sh). Isi `contracts/config/robinhood-mainnet.json`:

- `multisig`: Safe admin (owner timelock 48 jam, penyanggah oracle, guardian pause);
- `keeper`: alamat bot keeper (mendapat `PROPOSER_ROLE` di oracle);
- `treasury`; `stockDrip` boleh `0x0` sampai `DrippStaking` ada;
- cek ulang alamat Uniswap / WETH / USDG / Stock Token di [Blockscout](https://robinhoodchain.blockscout.com)
  (diambil dari robinhood-chain-sdk, bukan daftar resmi Robinhood).

```sh
cd contracts
forge test
DRIPP_CONFIG=config/robinhood-mainnet.json forge script script/Deploy.s.sol \
  --rpc-url $RPC_URL --private-key $DEPLOYER_KEY --broadcast --slow
# -> contracts/deployments/4663.json (alamat + blok awal untuk indexer/API/keeper)
```

Uji dulu di fork: `ROBINHOOD_RPC_URL=$RPC_URL forge test --match-contract Fork -vvv`.

## 2. Server

Satu VM dengan Docker (2 vCPU / 4 GB cukup untuk awal), domain yang A-record-nya mengarah ke VM, port 80/443 terbuka.

```sh
git clone <repo> dripp && cd dripp
cp .env.production.example .env      # isi DOMAIN, POSTGRES_PASSWORD, ADMIN_API_KEY, RPC_URL, KEEPER_PRIVATE_KEY, ...
docker compose up -d --build
docker compose logs -f indexer       # tunggu "Started live indexing"
```

- `https://$DOMAIN` → web, `https://$DOMAIN/api/*` → API (termasuk WebSocket `/api/ws`). Sertifikat
  Let's Encrypt otomatis lewat Caddy.
- `RPC_URL` dipakai indexer/API/keeper: pakai provider khusus (RPC publik dibatasi rate-nya).
- `KEEPER_PRIVATE_KEY` kosong = keeper *dry run* (hanya log). Isi kunci alamat `keeper` dari langkah 1.
- `ALERT_WEBHOOK_URL` (Slack/Discord) menerima alert saat perubahan multiplier tidak bisa diklasifikasi.
- Variabel `NEXT_PUBLIC_*` dibakar saat build image web: setelah mengganti `DOMAIN`, `CHAIN_ID`, `PUBLIC_RPC_URL`
  atau `WC_PROJECT_ID`, jalankan `docker compose up -d --build web`.

## 3. Setelah live

- Umumkan aksi korporasi (dividen/split) agar keeper mengklasifikasikan dengan benar:
  `curl -X POST https://$DOMAIN/api/admin/corporate-actions -H "x-admin-key: $ADMIN_API_KEY" -H 'content-type: application/json' -d '{"stockToken":"0x…","kind":"split","ratio":"2:1","exDate":"2027-01-15"}'`
- Moderasi komentar: `DELETE /api/admin/comments/:id`, `POST /api/admin/bans`.
- Seri baru dan perubahan fee lewat multisig + timelock (`DrippVaultFactory.createVault`, `setFees`, …).
- Backup: volume `pgdata` (komentar, referral, pengumuman). Data indexer bisa dibangun ulang dari chain.

## Alternatif hosting web

`web/` juga bisa di-deploy ke Vercel dengan `NEXT_PUBLIC_API_URL` mengarah ke API yang dijalankan di server
(lihat bagian berikut).

## Preview frontend di Vercel

Frontend (`web/`) bisa di-deploy ke Vercel, bahkan sebelum backend online:

1. Di vercel.com → **Add New… → Project**, import repo `pauly-zyz/Dripp`.
2. **Root Directory**: `web`. Konfigurasi build ada di `web/vercel.json` (Next.js, pnpm workspace).
3. Deploy. Setiap push ke branch mana pun otomatis mendapat URL preview.

Tanpa `NEXT_PUBLIC_API_URL`, build Vercel otomatis berjalan dalam **mode demo**: data contoh dari
`web/lib/demo.ts`, banner "Mode demo" di atas, dan transaksi tidak dikirim. Setelah kontrak dan
backend online, isi Environment Variables di Vercel lalu redeploy:

| Variabel | Isi |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://domain-anda/api` |
| `NEXT_PUBLIC_CHAIN_ID` | `4663` |
| `NEXT_PUBLIC_RPC_URL` | RPC Robinhood Chain |
| `NEXT_PUBLIC_WC_PROJECT_ID` | Project ID WalletConnect (opsional) |
| `NEXT_PUBLIC_DEMO` | `0` (atau `1` untuk memaksa mode demo) |
