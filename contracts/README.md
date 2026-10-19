# Dripp contracts

Foundry + OpenZeppelin v5.4.0, Solidity 0.8.28.

```sh
git submodule update --init --recursive
forge build --sizes
forge test            # unit, fuzz, invariant, router vs real Uniswap v3 bytecode
```

## Kontrak

| Kontrak              | Fungsi |
|----------------------|--------|
| `DividendOracle`     | Mengklasifikasikan setiap perubahan `uiMultiplier` sebagai dividen dan/atau stock split. Masa sanggah 24 jam, disanggah oleh multisig. Menyimpan *dividend index* per Stock Token (dengan riwayat per waktu). |
| `DrippVaultFactory`  | Registry seri. Allowlist Stock Token beserta ticker-nya (harus terdaftar di oracle), buat satu `DrippVault` per (saham, jatuh tempo), atur deposit cap, fee, treasury, Stock Drip, guardian, pause/unpause. |
| `DrippVaultDeployer` | Menyimpan bytecode `DrippVault` agar factory tetap di bawah batas 24 KB. |
| `DrippVault`         | `split`, `merge`, `redeemPT`, `claimYield`, `updateIndex`; akuntansi akrual YT dari dividend index oracle. Pausable, ReentrancyGuard. |
| `PTToken` / `YTToken`| ERC-20 + permit (`pAAPL-MAR27`, `yAAPL-MAR27`). Mint/burn hanya oleh vault; setiap perubahan saldo YT memicu checkpoint akrual. |
| `DrippRouter`        | Zap ETH / USDG / WETH / saham → PT, YT, atau PT+YT lewat Uniswap v3, dengan `minOut` + `deadline`. |

Nama seri = `<TICKER>-<BULAN><TAHUN>` dari tanggal jatuh tempo (UTC), mis. `AAPL-MAR27`.
Cari vault lewat `factory.getVault(stock, maturity)` atau `factory.getVaultBySeries("AAPL-MAR27")`.

## Dividen vs split (`DividendOracle`)

`uiMultiplier = dividendIndex × splitFactor` (per usulan terakhir yang dikonfirmasi).

1. Keeper (`PROPOSER_ROLE`) melihat `uiMultiplier()` berubah (`needsProposal(token)`), lalu memanggil:
   - `proposeDividend(token)`: seluruh perubahan adalah dividen;
   - `proposeSplit(token)`: seluruh perubahan adalah split / reverse split;
   - `propose(token, splitRatio)`: campuran, mis. split 2:1 (`2e18`) plus dividen untuk sisanya.

   Nilai multiplier selalu dibaca on-chain dari token, jadi yang bisa salah hanya klasifikasinya.
2. Selama 24 jam multisig (`DISPUTER_ROLE`) bisa `dispute(token)`. Keeper lalu mengusulkan ulang dengan
   klasifikasi yang benar.
3. Setelah 24 jam siapa pun bisa `confirm(token)`. Hanya bagian dividen yang menaikkan `dividendIndex`.

Satu usulan aktif per token. Dividend index tidak pernah turun (usulan yang membuatnya turun ditolak).

## Cara kerja vault

Satuan PT/YT = saham saat seri dibuat: `raw × I / 1e18`, dengan
`I = dividendIndex × splitFactor_saat_seri_dibuat`. Saat seri dibuat `I == uiMultiplier`, jadi 1 PT + 1 YT = 1 saham.

- **split(raw)** → mint `raw·I/1e18` PT **dan** YT.
- **merge(a)** kapan saja → bakar `a` PT + `a` YT, terima `a·1e18/I` token mentah (setelah jatuh tempo sama dengan `redeemPT`).
- **YT**: memegang `a` YT saat `I` naik `I0 → I1` (dividen terkonfirmasi) memberi `a·1e18/I0 − a·1e18/I1` token mentah.
- **Stock split** tidak mengubah `I`: YT tidak dapat apa-apa, dan setiap PT kini bernilai lebih banyak saham
  (`sharesPerPT()`, mis. `2e18` setelah split 2:1). Kenaikan yang belum dikonfirmasi oracle juga belum dihitung.
- **Checkpoint saat transfer YT**: yield sebelum transfer tetap milik pengirim.
- **Jatuh tempo**: akrual YT berhenti di dividend index oracle *per waktu `maturity`* (dibaca dari riwayat
  oracle, tidak bergantung keeper). Dividen yang dikonfirmasi setelah jatuh tempo menambah nilai PT; selisihnya
  dikirim ke `treasury` saat PT ditebus.
- Pembulatan selalu ke bawah (menguntungkan vault).

Catatan: dividen diakui saat **dikonfirmasi** (≥24 jam setelah terjadi), dan dibayarkan ke pemegang YT saat itu.
Dividen yang terjadi kurang dari 24 jam sebelum jatuh tempo dan dikonfirmasi setelahnya jatuh ke PT/treasury.
Harga YT di pasar seharusnya memperhitungkan usulan yang sedang dalam masa sanggah.

## Fee

Diatur di factory (owner = timelock). Nilai awal sesuai SPEC:

| Fee | Nilai | Batas maks | Dibayar dalam |
|-----|-------|------------|---------------|
| Klaim YT (`ytFeeBps`) | 5% dari dividen | 10% | Stock Token |
| Zap router (`zapFeeBps`) | 0,1% dari input | 1% | Token input (WETH untuk ETH, USDG, atau saham) |
| Split / merge / redeem PT | 0% | — | — |

Setiap fee dibagi `stockDripShareBps` (60%) ke `stockDrip` dan sisanya (40%) ke `treasury`.
Selama `stockDrip` = `0x0` (sebelum `DrippStaking` ada) seluruh fee ke treasury.
Yield pasca-jatuh-tempo (bukan fee) seluruhnya ke treasury.

## Router (`DrippRouter`)

```solidity
router.zap{value: 0.1 ether}(DrippRouter.ZapParams({
    vault: vault,
    target: DrippRouter.Target.PT,   // PT | YT | PY (split jadi PT+YT)
    tokenIn: address(0),             // ETH; atau USDG / WETH / saham
    amountIn: 0.1 ether,
    path: abi.encodePacked(WETH, uint24(500), USDG, uint24(3000), AAPL, uint24(3000), PT),
    minOut: quotedOut * 995 / 1000,  // proteksi slippage
    receiver: user,
    deadline: block.timestamp + 300
}));
```

`path` adalah path Uniswap v3 (`token, fee, token, …`) yang dibangun off-chain dari QuoterV2. Untuk PT/YT,
path berakhir di PT/YT (lewat pool PT/saham atau YT/saham). Untuk PY, path berakhir di saham. Router
memeriksa awal dan akhir path, `minOut` atas hasil akhir, dan `deadline`. `legacyRouter = true` untuk
SwapRouter klasik (testnet), `false` untuk SwapRouter02 (mainnet).

## Keamanan

- **Owner** factory dan admin oracle = `TimelockController` (default 48 jam) dengan multisig sebagai
  proposer/executor: allowlist dan registrasi saham, buat seri, deposit cap, fee, treasury, Stock Drip,
  guardian, unpause, peran oracle.
- **Guardian** (default = multisig, tanpa timelock): `pauseVault` seketika. Unpause hanya lewat owner.
- **Disputer** oracle = multisig, tanpa timelock (masa sanggah 24 jam).
- **Deposit cap** per vault, dalam saham. `UNCAPPED` = tanpa batas.

## Test

- `test/DrippVault.t.sol`: unit + fuzz (vault, factory, oracle, split vs dividen, fee).
- `test/invariant/`: urutan acak split/merge/transfer/klaim/redeem, perubahan multiplier, usulan
  dividen/split/campuran, sanggahan dan konfirmasi, dengan fee aktif:
  - **PT + YT = saham tersimpan** (selisih hanya debu pembulatan);
  - **tidak ada YT yang mengakrual dari split** (atau dari kenaikan yang belum dikonfirmasi);
  - indeks vault = dividend index oracle; konservasi saham; supply PT = YT sebelum jatuh tempo.
- `test/router/DrippRouter.local.t.sol`: router terhadap bytecode Uniswap v3 asli (`test/fixtures/uniswap`),
  dengan SwapRouter02 dan SwapRouter klasik.
- `test/router/DrippRouter.fork.t.sol`: skenario yang sama di **fork Robinhood Chain mainnet** (Uniswap,
  WETH, USDG, dan Stock Token asli; rute WETH→saham dicari otomatis, langsung atau via USDG):

  ```sh
  ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test --match-contract Fork -vvv
  ```

  Opsional: `ROBINHOOD_FORK_BLOCK`, `FORK_STOCK_INDEX` (indeks `stockTokens` di config). Tanpa
  `ROBINHOOD_RPC_URL` test ini di-skip. Uji kering tanpa RPC luar (anvil chain id 4663):

  ```sh
  anvil --chain-id 4663 &
  forge script test/router/LocalRobinhood.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
    --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
  ROBINHOOD_RPC_URL=http://127.0.0.1:8545 FORK_CONFIG=cache/local-robinhood.json forge test --match-contract Fork
  ```

CI (`.github/workflows/contracts.yml`) menjalankan ketiganya; job fork memakai secret `ROBINHOOD_RPC_URL`
jika ada, selain itu RPC publik.

## Konfigurasi

`config/robinhood-mainnet.json` dan `config/robinhood-testnet.json` sudah berisi alamat Uniswap v3, WETH,
USDG dan beberapa Stock Token. Sumbernya [robinhood-chain-sdk](https://github.com/nirholas/robinhood-chain-sdk)
(diverifikasi on-chain oleh pembuatnya, bukan daftar resmi Robinhood). **Cek ulang di
[Blockscout](https://robinhoodchain.blockscout.com) sebelum broadcast.** Untuk jaringan lain salin
`config/example.json`.

| Field           | Arti |
|-----------------|------|
| `multisig`      | Multisig admin: proposer/executor timelock, disputer + proposer oracle, guardian default. **Wajib.** |
| `keeper`        | Alamat bot keeper yang mengusulkan dividen/split ke oracle. **Wajib.** |
| `timelockDelay` | Detik, default `172800` (48 jam). |
| `owner`         | Owner akhir factory + admin oracle. `0x0` → deploy `TimelockController` baru untuk `multisig`. |
| `guardian`      | Boleh pause. `0x0` → `multisig`. |
| `treasury`      | Penerima 40% fee dan yield pasca-jatuh-tempo. **Wajib.** |
| `stockDrip`     | Penerima 60% fee (nanti `DrippStaking`). `0x0` → semua ke treasury. |
| `factory`, `oracle` | Kontrak yang sudah ada (broadcaster harus owner/admin), atau `0x0` untuk deploy baru. |
| `uniswap`       | `swapRouter`, `legacyRouter`, `weth`, `usdg` untuk `DrippRouter` (`swapRouter` = `0x0` → router tidak di-deploy); `v3Factory`, `positionManager` dipakai test fork. |
| `stockTokens[]` | `ticker`, `address`, `depositCap` (saham utuh, `0` = tanpa batas), `maturities` (unix detik, UTC). |

```sh
DRIPP_CONFIG=config/robinhood-mainnet.json forge script script/Deploy.s.sol \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
```

Script menolak jalan jika alamat wajib masih `0x000…`. Setelah setup, kepemilikan factory dan admin oracle
langsung dipindah ke owner akhir (timelock).
