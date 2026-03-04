/**
 * Open login -> unregister SW + clear caches -> click Quick Demo -> verify index.html?dev=1 within 8s.
 * Screenshot landing page; report final URL and console errors. JSON report + screenshots.
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE_URL = "http://127.0.0.1:8080";
const RESULTS_DIR = path.join(__dirname, "..", "browser-test-results");

const report = {
  step1_openAndClear: null,
  step2_clickQuickDemoAndNavigate: null,
  finalUrl: null,
  consoleErrors: [],
  screenshotPath: null,
  timestamp: new Date().toISOString(),
};

function rel(p) {
  return path.relative(path.join(__dirname, ".."), p).split(path.sep).join("/");
}

async function run() {
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: undefined });
  context.on("console", (msg) => {
    if (msg.type() === "error") report.consoleErrors.push(msg.text());
  });
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/login.html`, { waitUntil: "domcontentloaded", timeout: 10000 });
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.clearBrowserCache");
    } catch (_) {}
    const swRegs = await page.evaluate(() =>
      navigator.serviceWorker ? navigator.serviceWorker.getRegistrations() : Promise.resolve([])
    ).catch(() => []);
    for (const reg of swRegs || []) await reg.unregister();
    await page.goto(`${BASE_URL}/login.html`, { waitUntil: "domcontentloaded", timeout: 10000 });
    report.step1_openAndClear = "passed";
  } catch (e) {
    report.step1_openAndClear = "failed";
    report.step1_error = e.message;
  }

  try {
    await page.click("#quick-demo-btn");
    await page.waitForURL(/index\.html/, { timeout: 8000 });
    report.finalUrl = page.url();
    const url = new URL(page.url());
    const ok = url.pathname.endsWith("index.html") && url.searchParams.get("dev") === "1";
    report.step2_clickQuickDemoAndNavigate = ok ? "passed" : "failed";
    if (!ok) report.step2_note = `Expected index.html?dev=1, got ${page.url()}`;
  } catch (e) {
    report.step2_clickQuickDemoAndNavigate = "failed";
    report.step2_error = e.message;
    report.finalUrl = page.url();
  }

  const shot = path.join(RESULTS_DIR, "landing-after-quick-demo.png");
  await page.screenshot({ path: shot });
  report.screenshotPath = rel(shot);

  await context.close();
  await browser.close();

  const reportPath = path.join(RESULTS_DIR, "quick-demo-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  return report;
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
