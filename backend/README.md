# backend

Placeholder (Prompt 3 SPEC.md). Node.js TypeScript + PostgreSQL + Redis: endpoint `/markets`, `/calendar`,
`/users/:address/portfolio`, `/oracle/proposals`, dll., serta keeper:

- pantau `uiMultiplier()` tiap Stock Token (`DividendOracle.needsProposal(token)`), klasifikasikan
  perubahan sebagai dividen atau split (dari data aksi korporasi), lalu panggil `proposeDividend`,
  `proposeSplit` atau `propose(token, splitRatio)`;
- setelah masa sanggah 24 jam lewat, panggil `DividendOracle.confirm(token)`.

Indeks jatuh tempo vault dibaca dari riwayat oracle, jadi keeper tidak perlu memanggil `updateIndex()` tepat waktu.
