import { chromium } from "file:///C:/Users/rapha/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
import path from "node:path";

const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const baseUrl = process.argv[2] || "http://127.0.0.1:8787";
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
const consoleErrors = [];
const pageErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(String(error)));
await page.goto(`${baseUrl}/#open-chat`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForFunction(() => document.querySelector("#capture-label")?.textContent === "LIVE API");
await page.locator('[data-mode="network"]').click();
await page.waitForSelector(".network-node");
const openChat = await page.evaluate(() => ({
  live: document.querySelector("#capture-label")?.textContent,
  theme: document.documentElement.dataset.theme,
  roster: document.querySelectorAll(".agent-row").length,
  networkNodes: document.querySelectorAll(".network-node").length,
  networkEdges: document.querySelectorAll(".network-edge").length,
  networkTitle: document.querySelector(".network-head strong")?.textContent,
  width: document.documentElement.clientWidth,
  scrollWidth: document.documentElement.scrollWidth,
}));
await page.locator(".network-node").first().click();
const detail = await page.locator("#network-detail").innerText();
await page.screenshot({ path: path.resolve("live-open-chat-network.png"), fullPage: false });

await page.locator('[data-village="swarm"]').click();
await page.waitForFunction(() => document.querySelector(".network-head strong")?.textContent === "Cross-faction topology");
const swarm = await page.evaluate(() => ({
  roster: document.querySelectorAll(".agent-row").length,
  networkNodes: document.querySelectorAll(".network-node").length,
  networkEdges: document.querySelectorAll(".network-edge").length,
  title: document.querySelector(".network-head strong")?.textContent,
}));

await page.setViewportSize({ width: 390, height: 844 });
await page.locator('[data-village="open-chat"]').click();
const mobile = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, networkNodes: document.querySelectorAll(".network-node").length }));

const report = {
  passed: openChat.live === "LIVE API"
    && openChat.theme === "light"
    && openChat.roster >= 12
    && openChat.networkNodes >= 8
    && openChat.networkEdges >= 8
    && openChat.networkTitle === "Conversation topology"
    && detail.includes("Strongest visible connection")
    && openChat.scrollWidth <= openChat.width
    && swarm.roster === 133
    && swarm.networkNodes >= 4
    && swarm.networkEdges >= 3
    && swarm.title === "Cross-faction topology"
    && mobile.scrollWidth <= mobile.width
    && mobile.networkNodes >= 8
    && consoleErrors.length === 0
    && pageErrors.length === 0,
  openChat, swarm, mobile, consoleErrors, pageErrors,
};
await browser.close();
process.stdout.write(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
