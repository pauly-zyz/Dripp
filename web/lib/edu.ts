/** Education copy for tooltips (SPEC: "tooltip edukasi PT/YT untuk pemula"). */
export const EDU = {
  pt: "PT (Principal Token) = pokok saham. 1 PT ditebus jadi 1 saham saat jatuh tempo. Dibeli di bawah harga saham, selisihnya adalah imbal hasil tetap Anda.",
  yt: "YT (Yield Token) = hak atas dividen. Pemegang YT menerima semua dividen saham sampai jatuh tempo, dalam bentuk saham. Setelah jatuh tempo YT tidak bernilai lagi.",
  ptPlusYt: "1 PT + 1 YT = 1 saham. Anda bisa memecah saham (split) jadi PT + YT, atau menggabungkannya kembali (merge) kapan saja tanpa biaya.",
  fixedApy:
    "Imbal hasil tetap tersirat: keuntungan per tahun jika Anda membeli PT sekarang dan memegangnya sampai jatuh tempo, diukur dalam jumlah saham. Harga saham tetap naik-turun.",
  impliedDividend:
    "Dividen tersirat: dividen per tahun yang diharapkan pasar, dihitung dari harga YT. Jika dividen nyata lebih besar, pemegang YT untung.",
  realizedDividend:
    "Dividen terealisasi: dividen yang benar-benar dibayar saham ini dalam 12 bulan terakhir (dikonfirmasi oracle), disetahunkan. Tampil setelah ada data minimal 90 hari.",
  risk: "Skor risiko 0–100 (makin tinggi makin berisiko): kedalaman likuiditas pool PT/YT, waktu ke jatuh tempo, status oracle dividen, dan konsentrasi pemegang.",
  tvl: "Total saham yang tersimpan di vault seri ini.",
  maturity: "Tanggal jatuh tempo: PT bisa ditebus jadi saham, dan YT berhenti menerima dividen.",
  oracle:
    "Kenaikan multiplier saham diusulkan sebagai dividen atau stock split, lalu ditahan 24 jam. Selama itu multisig bisa menyanggah. Stock split tidak menambah hak YT.",
  split: "Setor saham, terima PT dan YT dalam jumlah sama.",
  merge: "Gabungkan PT + YT dengan jumlah sama kembali menjadi saham. Gratis, kapan saja.",
  redeem: "Setelah jatuh tempo, tukar PT menjadi saham dasar.",
  claim: "Ambil dividen YT yang sudah terkumpul, dalam bentuk saham. Fee 5% dari dividen.",
  slippage: "Batas selisih harga yang Anda terima. Transaksi dibatalkan jika hasil di bawah batas ini.",
  backing: "Saham di vault dibanding PT yang beredar. ≥ 1,00× berarti semua PT tertutup penuh (sisanya untuk dividen YT).",
} as const;
