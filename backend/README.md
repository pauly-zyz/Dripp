# backend

Placeholder (Prompt 3 SPEC.md). Node.js TypeScript + PostgreSQL + Redis: endpoint `/markets`, `/calendar`,
`/users/:address/portfolio`, `/oracle/proposals`, dll., serta keeper:

- pantau `uiMultiplier()` tiap Stock Token dan usulkan dividen/split ke `DividendOracle`;
- panggil `DrippVault.updateIndex()` tepat saat `maturity` agar akrual YT dibekukan pada indeks yang benar.
