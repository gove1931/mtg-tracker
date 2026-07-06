/**
 * MTG Tracker スクリーンショット自動撮影スクリプト
 *
 * 使い方:
 *   cd scripts && npm install
 *   node screenshot.js                         # VPS (デフォルト)
 *   node screenshot.js http://localhost:5173/  # ローカル開発サーバー
 *
 * 撮影結果: scripts/screenshots/ に保存
 */

const puppeteer = require("puppeteer");
const path = require("path");
const fs = require("fs");

const BASE_URL = process.argv[2] || "http://163.44.125.213/mtg-tracker/";
const OUT_DIR = path.join(__dirname, "screenshots");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// テキストで button を探してクリック
async function clickByText(page, text, partial = true) {
  await page.evaluate(
    (text, partial) => {
      const btns = Array.from(document.querySelectorAll("button"));
      const btn = partial
        ? btns.find((b) => b.textContent.trim().includes(text))
        : btns.find((b) => b.textContent.trim() === text);
      if (!btn) throw new Error(`Button not found: "${text}"`);
      btn.click();
    },
    text,
    partial
  );
  await sleep(400);
}

// input[type=number] に値をセット
async function fillNumber(page, placeholder, value) {
  const input = await page.$(`input[placeholder="${placeholder}"]`);
  if (!input) throw new Error(`Input not found: ${placeholder}`);
  await input.click({ clickCount: 3 });
  await input.type(String(value));
  await sleep(200);
}

async function shot(page, name) {
  const file = path.join(OUT_DIR, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  ✓ ${name}`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath:
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--ignore-certificate-errors"],
  });

  const page = await browser.newPage();
  // iPhone 14 サイズ（Retina）
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

  console.log(`\nURL: ${BASE_URL}\n`);

  // ── 1. ホーム画面 ──────────────────────────────────
  console.log("[1/7] ホーム画面");
  await page.goto(BASE_URL, { waitUntil: "networkidle0", timeout: 30000 });
  await sleep(600);
  await shot(page, "01_home.png");

  // ── 2. 記録メニュー ────────────────────────────────
  console.log("[2/7] 記録メニュー");
  await clickByText(page, "ゲームを記録する");
  await shot(page, "02_record_menu.png");

  // ── 3. イベント設定 ────────────────────────────────
  console.log("[3/7] イベント設定");
  await clickByText(page, "Arena Direct");
  await sleep(300);
  // 消費ジェムのプリセット 6000 を選択
  await clickByText(page, "6,000");
  await sleep(200);
  await shot(page, "03_setup.png");

  // ── 4. Run 入力画面（勝利数選択後）──────────────────
  console.log("[4/7] Run入力画面");
  await clickByText(page, "イベント開始");
  await sleep(400);
  // サマリーから Run 記録へ
  await clickByText(page, "+ 次のRunを記録");
  await sleep(400);
  // 勝利数 5 を選択
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll(".win-btn"));
    const btn = btns.find((b) => b.textContent.trim() === "5");
    if (btn) btn.click();
  });
  await sleep(300);
  // プライズ「ジェム」を選択
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll(".prize-btn"));
    const btn = btns.find((b) => b.textContent.includes("ジェム"));
    if (btn) btn.click();
  });
  await sleep(300);
  // ジェム数プリセット 5400 を選択
  await clickByText(page, "5,400");
  await sleep(200);
  await shot(page, "04_run_entry.png");

  // ── 5. サマリー画面（Run 3件） ──────────────────────
  console.log("[5/7] サマリー画面（Run 3件）");
  // Run #1 を保存
  await clickByText(page, "Runを保存");
  await sleep(400);

  // Run #2: 7勝0敗、ジェム 10800
  await clickByText(page, "+ 次のRunを記録");
  await sleep(400);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll(".win-btn"));
    const btn = btns.find((b) => b.textContent.trim() === "7");
    if (btn) btn.click();
  });
  await sleep(300);
  // 敗数 0 を選択
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll(".win-btn"));
    const btn = btns.find((b) => b.textContent.trim() === "0");
    if (btn) btn.click();
  });
  await sleep(200);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll(".prize-btn"));
    const btn = btns.find((b) => b.textContent.includes("ジェム"));
    if (btn) btn.click();
  });
  await sleep(200);
  await clickByText(page, "10,800");
  await sleep(200);
  await clickByText(page, "Runを保存");
  await sleep(400);

  // Run #3: 3勝2敗、なし
  await clickByText(page, "+ 次のRunを記録");
  await sleep(400);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll(".win-btn"));
    const btn = btns.find((b) => b.textContent.trim() === "3");
    if (btn) btn.click();
  });
  await sleep(200);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll(".prize-btn"));
    const btn = btns.find((b) => b.textContent.includes("なし"));
    if (btn) btn.click();
  });
  await sleep(200);
  await clickByText(page, "Runを保存");
  await sleep(500);

  await shot(page, "05_summary.png");

  // ── 6. 履歴一覧 ────────────────────────────────────
  console.log("[6/7] 履歴一覧");
  // ホームに戻る（DBには保存しない）
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const btn = btns.find((b) => b.textContent.includes("← ホーム"));
    if (btn) btn.click();
  });
  await sleep(400);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const btn = btns.find((b) => b.textContent.includes("過去の履歴を見る"));
    if (btn) btn.click();
  });
  await sleep(1200); // Notion API 取得を待つ
  await shot(page, "06_history.png");

  // ── 7. イベント詳細（データがある場合のみ） ──────────
  console.log("[7/7] イベント詳細（データがあれば）");
  const hasEvents = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    return btns.some((b) => b.textContent.includes("Run"));
  });
  if (hasEvents) {
    // 最初の月を開く
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const monthBtn = btns.find((b) => b.textContent.match(/\d{4}年\d+月/));
      if (monthBtn) monthBtn.click();
    });
    await sleep(400);
    // 最初のイベントをクリック
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const eventBtn = btns.find((b) => b.textContent.match(/\d+Run/));
      if (eventBtn) eventBtn.click();
    });
    await sleep(1000); // Run取得を待つ
    await shot(page, "07_history_detail.png");
  } else {
    console.log("  (履歴データなし: スキップ)");
  }

  await browser.close();
  console.log(`\n完了！ screenshots/ に保存しました。\n`);
}

main().catch((e) => {
  console.error("エラー:", e.message);
  process.exit(1);
});
