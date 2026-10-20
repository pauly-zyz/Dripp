import { expect, test } from "@playwright/test";
import { ALICE, BOB, DAVE, connect, injectWallet } from "./wallet";

const shot = (name: string) => `../.e2e/screens/${name}.png`;

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const rpc = async (method: string, params: unknown[]) =>
  (await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;

/** Trace of the last transaction sent by `from` (anvil debug API), to explain a revert. */
async function lastTxDiagnostics(from: string) {
  const latest = await rpc("eth_getBlockByNumber", ["latest", true]);
  for (let n = Number(latest.number); n > Number(latest.number) - 10; n--) {
    const b = await rpc("eth_getBlockByNumber", ["0x" + n.toString(16), true]);
    const tx = b.transactions.find((t: { from: string }) => t.from.toLowerCase() === from.toLowerCase());
    if (!tx) continue;
    const trace = await rpc("debug_traceTransaction", [tx.hash, { tracer: "callTracer" }]);
    const deadline = tx.input.length > 10 ? BigInt("0x" + tx.input.slice(10 + 64 * 8, 10 + 64 * 9)) : null;
    return { block: n, blockTime: Number(b.timestamp), gas: tx.gas, gasUsed: trace?.gasUsed, error: trace?.error, revertReason: trace?.revertReason, output: trace?.output?.slice(0, 74), deadlineWord8: deadline?.toString() };
  }
  return null;
}

test("markets lists the series with fixed yield, prices and risk", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Markets" })).toBeVisible();
  const row = page.getByRole("link", { name: /AAPL · MAR27/ });
  await expect(row).toBeVisible();
  await expect(row.getByText(/tetap \/ tahun/)).toBeVisible();
  await expect(row.getByText(/Risiko \d+/)).toBeVisible();
  // education tooltip
  await page.getByRole("button", { name: "PT" }).first().click();
  await expect(page.getByRole("tooltip")).toContainText("Principal Token");
  // the open tooltip stays inside the viewport: no horizontal page scroll
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: shot(`markets-${info.project.name}`), fullPage: true });
});

test("series detail shows chart, risk breakdown, calendar and comments", async ({ page }, info) => {
  await page.goto("/market/AAPL-MAR27");
  await expect(page.getByRole("heading", { name: "AAPL-MAR27" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Riwayat harga PT/ })).toBeVisible();
  await page.getByRole("tab", { name: "Imbal hasil" }).click();
  await expect(page.getByRole("img", { name: /Riwayat imbal hasil PT/ })).toBeVisible();
  await expect(page.getByText("Imbal hasil tetap tersirat").first()).toBeVisible();
  await expect(page.getByText("Likuiditas pool PT/YT")).toBeVisible();
  await expect(page.getByText(/Dividen 1(\.00)?%/).first()).toBeVisible();
  await expect(page.getByText(/Stock split 2(\.00)?:1/).first()).toBeVisible();
  await expect(page.getByText("Terjadwal").first()).toBeVisible(); // next on-chain dividend
  await expect(page.getByText(/Hubungkan wallet untuk ikut berdiskusi/)).toBeVisible();
  await page.screenshot({ path: shot(`detail-${info.project.name}`), fullPage: true });
});

test("transparency shows oracle history, reserves and contracts", async ({ page }, info) => {
  await page.goto("/transparency");
  await expect(page.getByRole("heading", { name: "Transparansi" })).toBeVisible();
  await expect(page.getByText("Tidak ada usulan yang sedang menunggu.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "AAPL-MAR27" })).toBeVisible();
  await expect(page.getByText(/1\.0\d+×/)).toBeVisible();
  await expect(page.getByText("DividendOracle")).toBeVisible();
  await expect(page.getByText("5%")).toBeVisible();
  await page.screenshot({ path: shot(`transparency-${info.project.name}`), fullPage: true });
});

test("no page scrolls sideways", async ({ page }) => {
  for (const path of ["/", "/earn", "/market/AAPL-MAR27", "/portfolio", "/transparency"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const [scroll, viewport] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(scroll, `${path} is ${scroll}px wide in a ${viewport}px viewport`).toBeLessThanOrEqual(viewport);
    expect(viewport, `${path} zoomed out to fit wide content`).toBe(page.viewportSize()!.width);
  }
});

test.describe("with wallet", () => {
  test("fixed income: buy PT with ETH in one click", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "one on-chain buy is enough");
    await injectWallet(page, DAVE);
    await page.goto("/earn");
    await connect(page);
    await page.getByLabel("Jumlah").fill("0.05");
    await expect(page.getByText(/Anda menerima ≈/)).toBeVisible();
    await expect(page.getByText(/Ditebus/)).toBeVisible();
    const buy = page.getByRole("button", { name: "Beli PT" });
    await expect(buy).toBeEnabled();
    await page.screenshot({ path: shot(`earn-${info.project.name}`), fullPage: true });
    await buy.click();
    // wait for the outcome toast; on failure the assertion message shows the wallet/contract error
    const outcome = page.getByRole("status").filter({ hasText: /Beli PT (berhasil|gagal)/ }).first();
    await expect(outcome).toBeVisible({ timeout: 60_000 });
    const text = await outcome.innerText();
    if (!text.includes("berhasil")) console.log("DIAGNOSTICS", JSON.stringify(await lastTxDiagnostics(DAVE)));
    expect(text).toContain("Beli PT berhasil");

    await page.goto("/portfolio");
    await expect(page.getByText(/^PT/).first()).toBeVisible();
    await expect(page.getByText("PnL total")).toBeVisible();
    await expect(page.getByLabel("Link referral")).toHaveValue(/\?ref=0x23618e81e3f5cdf7f54c3d65f7fbc0abf5b21e8f/);
    await expect(page.getByText("Zap → PT").first()).toBeVisible();
  });

  test("portfolio: bob claims his YT dividends", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "claims once");
    await injectWallet(page, BOB);
    await page.goto("/portfolio");
    await connect(page);
    const claim = page.getByRole("button", { name: "Claim All" });
    await expect(claim).toBeEnabled();
    await page.screenshot({ path: shot(`portfolio-${info.project.name}`), fullPage: true });
    await claim.click();
    const outcome = page.getByRole("status").filter({ hasText: /Klaim semua dividen (berhasil|gagal)/ }).first();
    await expect(outcome).toBeVisible({ timeout: 60_000 });
    expect(await outcome.innerText()).toContain("berhasil");
    await expect(claim).toBeDisabled();
  });

  test("series: post a signed comment", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "posts once");
    await injectWallet(page, ALICE);
    await page.goto("/market/AAPL-MAR27");
    await connect(page);
    const body = `PT diskon ${Date.now()}`;
    await page.getByLabel("Komentar").fill(body);
    await page.getByRole("button", { name: "Kirim" }).click();
    await expect(page.getByText(body)).toBeVisible();
    await page.screenshot({ path: shot(`detail-wallet-${info.project.name}`), fullPage: true });
  });
});
