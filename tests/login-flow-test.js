/**
 * Focused login flow: steps 1-6 against http://127.0.0.1:8080/login.html
 * Output: JSON report + screenshots in browser-test-results/
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE_URL = "http://127.0.0.1:8080";
const RESULTS_DIR = path.join(__dirname, "..", "browser-test-results");

const report = {
  step1_openAndClearCache: null,
  step2_atLeast3DemoItems: null,
  step3_clickDemoAndVerifyInputs: null,
  step4_quickDemoAndLanding: null,
  consoleErrors: [],
  screenshotPaths: [],
  finalLandingUrl: null,
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
    // 1. Open page; unregister SW and clear caches
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
    report.step1_openAndClearCache = "passed";
  } catch (e) {
    report.step1_openAndClearCache = "failed";
    report.step1_error = e.message;
  }

  // 2. Verify #demo-user-list contains at least 3 .demo-user-item (static fallback)
  try {
    await page.waitForSelector("#demo-user-list", { state: "visible", timeout: 5000 });
    const count = await page.locator("#demo-user-list .demo-user-item").count();
    report.step2_atLeast3DemoItems = count >= 3 ? "passed" : "failed";
    report.step2_count = count;
    if (count < 3) report.step2_error = `Expected >= 3 items, got ${count}`;
  } catch (e) {
    report.step2_atLeast3DemoItems = "failed";
    report.step2_error = e.message;
  }

  // Screenshot after load
  const shot1 = path.join(RESULTS_DIR, "login-after-load.png");
  await page.screenshot({ path: shot1 });
  report.screenshotPaths.push(rel(shot1));

  // 3. Click first .demo-user-item; verify username and password populated
  try {
    await page.waitForTimeout(1000);
    await page.locator("#demo-user-list .demo-user-item").first().locator(".demo-user-main").click();
    await page.waitForTimeout(400);
    const username = await page.locator("#username-input").inputValue();
    const password = await page.locator("#password-input").inputValue();
    const ok = !!username && !!password;
    report.step3_clickDemoAndVerifyInputs = ok ? "passed" : "failed";
    if (!ok) report.step3_detail = { username: username || "", passwordLength: (password || "").length };
  } catch (e) {
    report.step3_clickDemoAndVerifyInputs = "failed";
    report.step3_error = e.message;
  }

  // 4. Click Quick Demo; wait for navigation; verify index.html or index.html?dev=1
  try {
    await page.click("#quick-demo-btn");
    await page.waitForURL(/index\.html/, { timeout: 10000 });
    report.finalLandingUrl = page.url();
    const url = new URL(page.url());
    const isIndex = url.pathname.endsWith("index.html") || url.searchParams.get("dev") === "1";
    report.step4_quickDemoAndLanding = isIndex ? "passed" : "failed";
    const shot2 = path.join(RESULTS_DIR, "landing-after-quick-demo.png");
    await page.screenshot({ path: shot2 });
    report.screenshotPaths.push(rel(shot2));
  } catch (e) {
    report.step4_quickDemoAndLanding = "failed";
    report.step4_error = e.message;
    report.finalLandingUrl = page.url();
  }

  await context.close();
  await browser.close();

  const reportPath = path.join(RESULTS_DIR, "login-flow-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  return report;
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
