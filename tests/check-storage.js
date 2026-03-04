const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE_URL = "http://127.0.0.1:8080";
async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/login.html`, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.fill("#username-input", "planner");
    await page.fill("#password-input", "planner123");
    await page.click('.login-submit-btn[type="submit"]');
    await page.waitForURL(/index\.html/, { timeout: 8000 });
    // Read storage key
    const state = await page.evaluate(() => {
      try { return localStorage.getItem('industrial_planning_intelligence_state_v1'); }
      catch (e) { return null; }
    });
    console.log('STORAGE_KEY length:', state ? state.length : 'null');
    if (state) {
      const parsed = JSON.parse(state);
      console.log('Projects count:', (parsed.projects || []).length);
      console.log('Active project activities:', ((parsed.projects || [])[0] || {}).activities?.length || 0);
    }
  } catch (e) {
    console.error('error', e);
  } finally {
    await context.close();
    await browser.close();
  }
}
run();

