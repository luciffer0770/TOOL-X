const { chromium } = require("playwright");
const path = require("path");

const BASE_URL = "http://127.0.0.1:8080";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/login.html`, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.fill("#username-input", "planner");
    await page.fill("#password-input", "planner123");
    await page.click('.login-submit-btn[type="submit"]');
    await page.waitForURL(/index\.html/, { timeout: 8000 });

    await page.goto(`${BASE_URL}/activities.html`, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.waitForTimeout(500);
    // click Add Empty Row
    await page.click("#add-empty-btn");
    await page.waitForTimeout(500);
    // read storage
    const state = await page.evaluate(() => localStorage.getItem('industrial_planning_intelligence_state_v1'));
    console.log('state present:', !!state);
    if (state) {
      const parsed = JSON.parse(state);
      const activities = (parsed.projects?.[0]?.activities) || [];
      console.log('activities length after add:', activities.length);
    } else {
      console.log('no state found in localStorage');
    }
  } catch (e) {
    console.error('error', e);
  } finally {
    await browser.close();
  }
})();

