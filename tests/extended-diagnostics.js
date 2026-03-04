/**
 * Extended diagnostics: sign-in with credentials and check Activity Master, Anomaly, Intelligence pages.
 * Run: node tests/extended-diagnostics.js
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE_URL = "http://127.0.0.1:8080";
const RESULTS_DIR = path.join(__dirname, "..", "browser-test-results");

function ensureDir() {
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

async function run() {
  ensureDir();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const report = { timestamp: new Date().toISOString(), consoleErrors: [], pages: {} };

  context.on("console", (msg) => {
    if (msg.type() === "error") report.consoleErrors.push(msg.text());
  });

  try {
    await page.goto(`${BASE_URL}/login.html`, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.fill("#username-input", "planner");
    await page.fill("#password-input", "planner123");
    await page.click('.login-submit-btn[type="submit"]');
    // wait for navigation or timeout
    try {
      await page.waitForURL(/index\.html/, { timeout: 8000 });
    } catch {}
    report.pages.login = { url: page.url() };
    await page.screenshot({ path: path.join(RESULTS_DIR, "diag-01-after-login.png") });

    // Activity Master
    await page.goto(`${BASE_URL}/activities.html`, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.waitForTimeout(800);
    const activitiesCount = await page.locator("#activities-body tr").count().catch(() => 0);
    report.pages.activities = { url: page.url(), activitiesRowCount: activitiesCount };
    await page.screenshot({ path: path.join(RESULTS_DIR, "diag-02-activities.png") });

    // Anomaly Center
    await page.goto(`${BASE_URL}/anomaly-center.html`, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.waitForTimeout(800);
    const anomalyHeader = await page.locator("h2").first().innerText().catch(() => "");
    report.pages.anomaly = { url: page.url(), header: anomalyHeader };
    await page.screenshot({ path: path.join(RESULTS_DIR, "diag-03-anomaly.png") });

    // Intelligence (Delay & Risk)
    await page.goto(`${BASE_URL}/intelligence.html`, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.waitForTimeout(800);
    const intelHeader = await page.locator("h1, h2").first().innerText().catch(() => "");
    report.pages.intelligence = { url: page.url(), header: intelHeader };
    await page.screenshot({ path: path.join(RESULTS_DIR, "diag-04-intelligence.png") });

  } catch (err) {
    report.error = String(err);
  } finally {
    await context.close();
    await browser.close();
    const out = path.join(RESULTS_DIR, "extended-diagnostics.json");
    fs.writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
    console.log("Report written to", out);
  }
}

run().catch((e) => { console.error(e); process.exit(1); });

