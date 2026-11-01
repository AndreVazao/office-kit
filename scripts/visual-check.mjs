import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    const file = resolve(root, "." + pathname);
    if (file !== root && !file.startsWith(root + sep)) throw new Error("Invalid path");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

const failures = [];
const results = [];
const browserErrors = [];
const cases = [
  { name: "portrait-390x844", width: 390, height: 844 },
  { name: "landscape-844x390", width: 844, height: 390 },
  { name: "desktop-1366x768", width: 1366, height: 768 }
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await new Promise(resolveListen => server.listen(4173, "127.0.0.1", resolveListen));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const testCase of cases) {
    const page = await browser.newPage({ viewport: { width: testCase.width, height: testCase.height }, deviceScaleFactor: 1 });
    page.on("pageerror", error => browserErrors.push(testCase.name + ": " + error.message));
    page.on("console", message => { if (message.type() === "error") browserErrors.push(testCase.name + ": console: " + message.text()); });
    const response = await page.goto("http://127.0.0.1:4173/examples/browser-preview/index.html", { waitUntil: "networkidle" });
    assert(response?.ok(), testCase.name + ": preview did not load");
    await page.locator(".building").waitFor({ state: "visible" });
    await page.screenshot({ path: "visual-" + testCase.name + ".png", fullPage: true });

    const geometry = await page.evaluate(() => {
      const viewport = document.querySelector(".scene-viewport").getBoundingClientRect();
      const building = document.querySelector(".building").getBoundingClientRect();
      return {
        viewport: { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height },
        building: { x: building.x, y: building.y, width: building.width, height: building.height },
        documentWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        orientation: document.querySelector("#orientation-label").textContent,
        departmentCount: document.querySelectorAll(".department-button").length
      };
    });
    assert(geometry.building.width > 0 && geometry.building.height > 0, testCase.name + ": building has empty geometry");
    assert(geometry.documentWidth <= geometry.innerWidth, testCase.name + ": document has horizontal overflow");
    assert(geometry.building.x >= geometry.viewport.x - 2, testCase.name + ": building spills left of viewport");
    assert(geometry.building.x + geometry.building.width <= geometry.viewport.x + geometry.viewport.width + 2, testCase.name + ": building spills right of viewport");
    assert(geometry.departmentCount > 0, testCase.name + ": no departments rendered");

    await page.locator("#quality").selectOption("economy");
    assert(await page.locator("body").getAttribute("data-quality") === "economy", testCase.name + ": quality selector did not update");
    const firstDepartment = page.locator(".department-button").first();
    const overviewButton = page.locator("#view-overview");
    const beforeFocus = await page.locator(".building").boundingBox();
    await firstDepartment.click();
    assert(await firstDepartment.getAttribute("aria-pressed") === "true", testCase.name + ": department selection did not activate");
    assert(await overviewButton.isVisible(), testCase.name + ": overview reset button did not appear");
    await page.waitForTimeout(250);
    const focusedBox = await page.locator(".building").boundingBox();
    assert(focusedBox.height > beforeFocus.height * 1.3, testCase.name + ": selected department did not zoom scene; before=" + JSON.stringify(beforeFocus) + "; after=" + JSON.stringify(focusedBox) + "; transform=" + await page.locator(".building").evaluate(el => el.style.transform));
    await overviewButton.click();
    assert(await overviewButton.isHidden(), testCase.name + ": overview reset button did not hide after reset");
    const firstAgent = page.locator(".agent[role=button]").first();
    await firstAgent.click();
    assert(await page.locator("#agent-console").isVisible(), testCase.name + ": agent conversation panel did not open");
    await page.locator("#chat-input").fill("Teste visual");
    await page.locator("#chat-form button[type=submit]").click();
    assert(await page.locator(".chat-user").textContent() === "Teste visual", testCase.name + ": local chat did not render submitted message");
    assert((await page.locator(".chat-system").last().textContent()).includes("apenas nesta demonstração"), testCase.name + ": local chat did not clearly disclaim backend integration");
    await page.screenshot({ path: "visual-" + testCase.name + "-chat.png", fullPage: true });
    await page.locator("#chat-close").click();
    assert(await page.locator("#agent-console").isHidden(), testCase.name + ": agent conversation panel did not close");
    results.push({ ...testCase, geometry });
    await page.close();
  }
  assert(browserErrors.length === 0, "Browser errors: " + browserErrors.join(" | "));
  console.log(JSON.stringify({ status: "passed", cases: results, browserErrors }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", error: error.message, cases: results, browserErrors }, null, 2));
  failures.push(error);
} finally {
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
if (failures.length) process.exitCode = 1;
