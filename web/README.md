# web

Aplikasi Dripp: Next.js 16 (App Router) + Tailwind 4 + wagmi 2 / viem + RainbowKit. Mobile-first, tema gelap,
gaya minimalis ala aplikasi Robinhood. Robinhood Chain adalah jaringan default.

```sh
cp .env.example .env.local        # NEXT_PUBLIC_API_URL ke backend/, NEXT_PUBLIC_CHAIN_ID
pnpm --filter @dripp/web dev      # http://localhost:3000
pnpm --filter @dripp/web build && pnpm --filter @dripp/web start
```

Semua data berasal dari `backend/` (REST + WebSocket `/ws` untuk harga dan notifikasi dividen); alamat kontrak
diambil dari `GET /protocol`, jadi build yang sama bisa dipakai untuk deployment berbeda di chain yang sama.

## Halaman

| Path | Isi |
|------|-----|
| `/` Markets | Seri per saham: imbal hasil tetap tersirat, harga PT/YT (dalam saham), dividen tersirat, TVL, skor risiko; filter saham dan tenor; update live |
| `/earn` Fixed Income | Pilih saham + jatuh tempo, lihat imbal hasil tetap, beli PT sekali klik dari ETH/USDG (zap `DrippRouter`) dengan slippage dan minimal diterima |
| `/market/[series]` Detail seri | Grafik harga PT/YT, statistik, panel Beli/Jual/Split/Merge/Tebus, skor risiko dengan rincian, kalender ex-dividen, riwayat dividen & split, transaksi terakhir, komentar |
| `/portfolio` | Posisi PT/YT dan nilainya, dividen YT yang bisa diklaim + Claim All, pengingat jatuh tempo, aktivitas |
| `/transparency` | Usulan oracle dalam masa sanggah (hitung mundur), riwayat, cadangan per vault (rasio cadangan/PT), fee dan peran, alamat kontrak; tempat bukti LP $DRIPP dan vesting (fase 3) |

Lintas halaman: koneksi wallet (RainbowKit, Robinhood Chain default), notifikasi dividen/split lewat WebSocket,
link referral `?ref=0x…` (ditandatangani setelah wallet terhubung), tooltip edukasi PT/YT (`lib/edu.ts`).

Transaksi: kuotasi dari `GET /quote` (rute Uniswap v3 + `minOut`), approve otomatis bila allowance kurang,
deadline dihitung dari waktu blok, toast hasil + tautan explorer.

`NEXT_PUBLIC_WC_PROJECT_ID` (opsional) mengaktifkan wallet berbasis WalletConnect; tanpa itu tersedia wallet
browser (injected), Rabby, dan Coinbase.

`lib/x402-stub.ts`: paket opsional `@x402/*` yang diimpor SDK Coinbase (lewat RainbowKit) diarahkan ke stub di
`next.config.ts`; Dripp tidak memakai pembayaran x402.

## Test UI

`tests/ui.spec.ts` (Playwright, viewport Pixel 7 dan desktop) berjalan terhadap stack lokal lengkap. Wallet
diganti provider EIP-1193 tiruan yang meneruskan ke akun dev anvil, jadi beli PT, klaim dividen, dan komentar
bertanda tangan benar-benar dieksekusi. Screenshot disimpan di `.e2e/screens/`.

```sh
E2E_UI=1 bash ../scripts/e2e-local.sh    # anvil + kontrak + indexer + keeper + API + web + Playwright
```
