import { chromium } from "/Volumes/AI-Models/pantheon-app/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs";

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:3200", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForFunction(
  () => document.title.includes("Pantheon") || document.body.innerText.includes("Pantheon"),
  { timeout: 20000 },
);
await page.waitForTimeout(1500);
console.log("title:", await page.title());
console.log("body text head:", (await page.locator("body").innerText()).slice(0, 300).replace(/\n/g, " | "));
await page.screenshot({ path: "/Volumes/AI-Models/pantheon-app/screenshots/test.png" });
await browser.close();
console.log("screenshot saved");
