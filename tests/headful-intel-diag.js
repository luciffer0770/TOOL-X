/**
 * Headful diagnostic for the Intelligence page.
 * Launches a visible browser, signs in as planner, opens intelligence page,
 * exercises Save Root Cause and Run Scenario, captures console logs and screenshot.
 *
 * Run: node tests/headful-intel-diag.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:8080';
const OUT = path.join(__dirname, '..', 'browser-test-results', 'headful-intel-report.json');
const SCREEN = path.join(__dirname, '..', 'browser-test-results', 'headful-intel.png');

async function run() {
  if (!fs.existsSync(path.dirname(OUT))) fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const browser = await chromium.launch({ headless: false, args: ['--window-size=1400,900'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const logs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    logs.push({ type: msg.type(), text });
    console.log(`[console:${msg.type()}] ${text}`);
  });
  page.on('pageerror', (err) => {
    logs.push({ type: 'pageerror', text: String(err) });
    console.error('[pageerror]', err);
  });
  try {
    console.log('Navigating to login page...');
    await page.goto(`${BASE}/login.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.fill('#username-input', 'planner');
    await page.fill('#password-input', 'planner123');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(()=>{}),
      page.click('.login-submit-btn[type="submit"]'),
    ]);
    console.log('Opened dashboard, navigating to intelligence page...');
    await page.goto(`${BASE}/intelligence.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(800);

    // Capture initial state screenshot
    await page.screenshot({ path: SCREEN });
    console.log('Captured screenshot:', SCREEN);

    // Try to select an activity (if any)
    const hasSelect = await page.$('#root-cause-activity');
    if (hasSelect) {
      const count = await page.$$eval('#root-cause-activity option', (opts) => opts.length);
      console.log('root-cause-activity option count:', count);
      logs.push({ type: 'info', text: `root-cause-activity option count: ${count}` });
      if (count > 1) {
        // select second option (first is placeholder)
        await page.selectOption('#root-cause-activity', (await page.$eval('#root-cause-activity option:nth-child(2)', o=>o.value)));
        await page.fill('#root-cause-text', 'Automated test root cause note');
        await Promise.all([
          page.waitForResponse((r) => r.status() < 400, { timeout: 5000 }).catch(()=>null),
          page.click('#save-root-cause-btn').catch(()=>null),
        ]);
        console.log('Clicked Save Root Cause');
      } else {
        console.log('No selectable activities to update.');
      }
    } else {
      console.log('root-cause-activity element not found');
    }

    // Run simulation
    const simBtn = await page.$('#run-sim-btn');
    if (simBtn) {
      await Promise.all([
        page.waitForTimeout(800),
        simBtn.click().catch(()=>null),
      ]);
      console.log('Clicked Run Scenario');
    } else {
      console.log('Run Scenario button not found');
    }

    await page.waitForTimeout(800);
    // final screenshot
    const finalScreen = path.join(path.dirname(SCREEN), 'headful-intel-after.png');
    await page.screenshot({ path: finalScreen });
    console.log('Captured final screenshot:', finalScreen);

    const report = {
      timestamp: new Date().toISOString(),
      url: page.url(),
      logs,
      screenshots: [SCREEN, finalScreen],
    };
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
    console.log('Wrote report to', OUT);
  } catch (err) {
    console.error('Error during headful run:', err);
    fs.writeFileSync(OUT, JSON.stringify({ error: String(err), logs }, null, 2), 'utf8');
  } finally {
    // Keep browser open for user to inspect; close context but not browser immediately.
    await context.close();
    await browser.close();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });

