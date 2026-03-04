/**
 * Headful diagnostic for Dashboard buttons (Refresh, Take Tour).
 * Run: node tests/headful-dashboard-diag.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:8080';
const OUT = path.join(__dirname, '..', 'browser-test-results', 'headful-dashboard-report.json');
const SCREEN = path.join(__dirname, '..', 'browser-test-results', 'headful-dashboard.png');

async function run() {
  if (!fs.existsSync(path.dirname(OUT))) fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const browser = await chromium.launch({ headless: false, args: ['--window-size=1200,800'] });
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
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
    console.log('Navigating to index (dev) ...');
    await page.goto(`${BASE}/index.html?dev=1`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: SCREEN });
    console.log('Captured screenshot:', SCREEN);

    // Try Refresh button
    const refresh = await page.$('#dashboard-refresh-btn');
    if (refresh) {
      console.log('Clicking Refresh button...');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 8000 }).catch(()=>null),
        refresh.click().catch(()=>null),
      ]);
      logs.push({ type: 'info', text: 'Refresh clicked; new url ' + page.url() });
    } else {
      logs.push({ type: 'error', text: 'Refresh button not found' });
    }

    // Try Take Tour button
    const tour = await page.$('#dashboard-tour-btn');
    if (tour) {
      console.log('Clicking Take Tour button...');
      await Promise.all([
        page.waitForTimeout(2000),
        tour.click().catch(()=>null),
      ]);
      logs.push({ type: 'info', text: 'Take Tour clicked' });
      // wait to let onboarding overlay appear
      await page.waitForTimeout(1000);
      // capture screenshot after tour click
      const after = path.join(path.dirname(SCREEN), 'headful-dashboard-after.png');
      await page.screenshot({ path: after });
      logs.push({ type: 'info', text: 'Captured after screenshot: ' + after });
    } else {
      logs.push({ type: 'error', text: 'Take Tour button not found' });
    }

    const report = { timestamp: new Date().toISOString(), url: page.url(), logs, screenshots: [SCREEN] };
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
    console.log('Wrote report to', OUT);
  } catch (err) {
    console.error('Error during headful dashboard run:', err);
    fs.writeFileSync(OUT, JSON.stringify({ error: String(err), logs }, null, 2), 'utf8');
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((e)=>{ console.error(e); process.exit(1); });

