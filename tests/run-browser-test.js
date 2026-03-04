/**
 * Automated browser test: login page and navigation (http://127.0.0.1:8080).
 * Run: npm run test:browser (ensure dev server is running on 8080).
 * Screenshots and report saved to browser-test-results/
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE_URL = "http://127.0.0.1:8080";
const RESULTS_DIR = path.join(__dirname, "..", "browser-test-results");

const report = {
  steps: {},
  finalUrls: {},
  consoleErrors: [],
  consoleWarnings: [],
  screenshotPaths: {},
  passed: true,
  timestamp: new Date().toISOString(),
};

function ensureResultsDir() {
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

function screenshotPath(name) {
  return path.join(RESULTS_DIR, `screenshot-${name}.png`);
}

async function runTest() {
  ensureResultsDir();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    // Fresh storage: no service workers/caches from previous runs
    storageState: undefined,
  });

  // Collect console messages
  const consoleLogs = [];
  context.on("console", (msg) => {
    const text = msg.text();
    const type = msg.type();
    if (type === "error") report.consoleErrors.push(text);
    else if (type === "warning") report.consoleWarnings.push(text);
    consoleLogs.push({ type, text });
  });

  const page = await context.newPage();

  try {
    // --- Step 1: Navigate to login; clear caches via CDP if available ---
    report.steps.step1_navigate = "running";
    await page.goto(`${BASE_URL}/login.html`, { waitUntil: "domcontentloaded", timeout: 10000 });
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.clearBrowserCache");
      const swRegs = await page.evaluate(() =>
        navigator.serviceWorker ? navigator.serviceWorker.getRegistrations() : Promise.resolve([])
      );
      for (const reg of swRegs || []) await reg.unregister();
    } catch (_) {
      /* ignore if CDP or SW not available */
    }
    await page.goto(`${BASE_URL}/login.html`, { waitUntil: "domcontentloaded", timeout: 10000 });
    report.steps.step1_navigate = "passed";
  } catch (e) {
    report.steps.step1_navigate = "failed";
    report.steps.step1_error = String(e.message);
    report.passed = false;
  }

  // --- Step 2: Wait for load, screenshot ---
  report.steps.step2_load_screenshot = "running";
  await page.waitForTimeout(1500);
  await page.screenshot({ path: screenshotPath("01-login-loaded") });
  report.screenshotPaths.step2 = path.relative(path.join(__dirname, ".."), screenshotPath("01-login-loaded")).split(path.sep).join("/");
  report.steps.step2_load_screenshot = "passed";

  // --- Step 3: Verify #demo-user-list has three users (planner, management, technician) ---
  report.steps.step3_demo_users = "running";
  let demoUserListPresent = false;
  let demoUserCount = 0;
  let demoUserRoles = [];
  try {
    // Wait for JS to populate the list (module may load after domcontentloaded)
    await page.waitForSelector("#demo-user-list .demo-user-item", { state: "visible", timeout: 8000 });
    const list = await page.locator("#demo-user-list");
    const items = await list.locator(".demo-user-item").all();
    demoUserCount = items.length;
    for (const item of items) {
      const cls = await item.getAttribute("class");
      const m = (cls || "").match(/role-(\w+)/);
      demoUserRoles.push(m ? m[1] : "");
    }
    const hasPlanner = demoUserRoles.includes("planner");
    const hasManagement = demoUserRoles.includes("management");
    const hasTechnician = demoUserRoles.includes("technician");
    demoUserListPresent = demoUserCount === 3 && hasPlanner && hasManagement && hasTechnician;
    report.steps.step3_demo_users = demoUserListPresent ? "passed" : "failed";
    report.steps.step3_detail = { count: demoUserCount, roles: demoUserRoles };
    if (!demoUserListPresent) report.passed = false;
  } catch (e) {
    report.steps.step3_demo_users = "failed";
    report.steps.step3_error = String(e.message);
    report.passed = false;
  }

  // --- Step 4: Click first demo user (planner), verify inputs, screenshot ---
  report.steps.step4_fill_credentials = "running";
  try {
    const firstDemo = page.locator("#demo-user-list .demo-user-item").first();
    await firstDemo.click();
    await page.waitForTimeout(300);
    const username = await page.locator("#username-input").inputValue();
    const password = await page.locator("#password-input").inputValue();
    const filled = username === "planner" && password === "planner123";
    report.steps.step4_fill_credentials = filled ? "passed" : "failed";
    report.steps.step4_detail = { username, passwordFilled: !!password };
    if (!filled) report.passed = false;
    await page.screenshot({ path: screenshotPath("02-login-filled") });
    report.screenshotPaths.step4 = path.relative(path.join(__dirname, ".."), screenshotPath("02-login-filled")).split(path.sep).join("/");
  } catch (e) {
    report.steps.step4_fill_credentials = "failed";
    report.steps.step4_error = String(e.message);
    report.passed = false;
  }

  // --- Step 5: Click Quick Demo (Planner), wait for redirect, verify index.html, screenshot ---
  report.steps.step5_quick_demo = "running";
  let landingUrl = "";
  try {
    await page.click("#quick-demo-btn");
    await page.waitForURL(/index\.html/, { timeout: 10000 });
    landingUrl = page.url();
    const isIndex = /\/index\.html(\?.*)?$/.test(new URL(landingUrl).pathname + new URL(landingUrl).search) ||
      landingUrl.includes("index.html");
    report.steps.step5_quick_demo = isIndex ? "passed" : "failed";
    report.finalUrls.afterQuickDemo = landingUrl;
    if (!isIndex) report.passed = false;
    await page.waitForTimeout(1500);
    await page.screenshot({ path: screenshotPath("03-landing") });
    report.screenshotPaths.step5 = path.relative(path.join(__dirname, ".."), screenshotPath("03-landing")).split(path.sep).join("/");
  } catch (e) {
    report.steps.step5_quick_demo = "failed";
    report.steps.step5_error = String(e.message);
    report.finalUrls.afterQuickDemo = page.url();
    report.passed = false;
    try {
      await page.screenshot({ path: screenshotPath("03-landing-fail") });
      report.screenshotPaths.step5 = path.relative(path.join(__dirname, ".."), screenshotPath("03-landing-fail")).split(path.sep).join("/");
    } catch (_) {}
  }

  // --- Step 6a: Navigate to activities.html (by nav link or URL) ---
  report.steps.step6a_activities = "running";
  try {
    const activitiesLink = page.locator('a[data-nav][href="activities.html"]');
    if ((await activitiesLink.count()) > 0) {
      await activitiesLink.click();
    } else {
      await page.goto(`${BASE_URL}/activities.html`, { waitUntil: "networkidle", timeout: 10000 });
    }
    await page.waitForTimeout(1500);
    report.finalUrls.activities = page.url();
    await page.screenshot({ path: screenshotPath("04-activities") });
    report.screenshotPaths.step6a = path.relative(path.join(__dirname, ".."), screenshotPath("04-activities")).split(path.sep).join("/");
    report.steps.step6a_activities = "passed";
  } catch (e) {
    report.steps.step6a_activities = "failed";
    report.steps.step6a_error = String(e.message);
    report.passed = false;
  }

  // --- Step 6b: Navigate to gantt.html ---
  report.steps.step6b_gantt = "running";
  try {
    const ganttLink = page.locator('a[data-nav][href="gantt.html"]');
    if ((await ganttLink.count()) > 0) {
      await ganttLink.click();
    } else {
      await page.goto(`${BASE_URL}/gantt.html`, { waitUntil: "networkidle", timeout: 10000 });
    }
    await page.waitForTimeout(1500);
    report.finalUrls.gantt = page.url();
    await page.screenshot({ path: screenshotPath("05-gantt") });
    report.screenshotPaths.step6b = path.relative(path.join(__dirname, ".."), screenshotPath("05-gantt")).split(path.sep).join("/");
    report.steps.step6b_gantt = "passed";
  } catch (e) {
    report.steps.step6b_gantt = "failed";
    report.steps.step6b_error = String(e.message);
    report.passed = false;
  }

  // --- Step 7: Console errors/warnings already collected above ---
  report.steps.step7_console = "passed";

  // On failure: save page HTML for debugging
  if (!report.passed) {
    try {
      const html = await page.content();
      fs.writeFileSync(path.join(RESULTS_DIR, "page-debug.html"), html, "utf8");
      report.debugPagePath = path.relative(path.join(__dirname, ".."), path.join(RESULTS_DIR, "page-debug.html")).split(path.sep).join("/");
    } catch (_) {}
  }

  await context.close();
  await browser.close();

  // Write report
  const reportPath = path.join(RESULTS_DIR, "browser-test-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log("Report written to:", reportPath);
  console.log("Screenshots in:", RESULTS_DIR);
  return report;
}

runTest()
  .then((r) => {
    console.log("\n--- Summary ---");
    console.log("Passed:", r.passed);
    console.log("Steps:", JSON.stringify(r.steps, null, 2));
    console.log("Final URLs:", JSON.stringify(r.finalUrls, null, 2));
    if (r.consoleErrors.length) console.log("Console errors:", r.consoleErrors);
    if (r.consoleWarnings.length) console.log("Console warnings:", r.consoleWarnings);
  })
  .catch((err) => {
    console.error("Test run failed:", err);
    process.exit(1);
  });
