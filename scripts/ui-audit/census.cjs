// 界面样式普查（census）：数一数页面上实际用了几种字号、圆角、按钮样式、表头样式、文字颜色……
// 种类越多，界面越乱。D-028 的组件套件（src/ui-kit.css）上线后，这些数字只能往下走。
//
//   node scripts/web-trial/serve.cjs /path/to/lai-web.html 8861 &
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core node scripts/ui-audit/census.cjs --url http://127.0.0.1:8861/ [选项]
//
// 选项：
//   --themes pink,tech          要数的主题（默认 pink,tech；每个主题单独计数）
//   --routes a,b                只数这几页（默认全部；--check 时必须是全部）
//   --out FILE                  把详细结果（每一种样式和它出现的次数）写进这个 JSON
//   --check                     和 census-baseline.json 比较：任何一个数字比基线多就失败（退出码 1）
//   --write-baseline            把这次的数字写成新的基线（只在确认变少、或增加有理由时用）
//
// 页面需要网页试用版自带的示例数据（LaiWebTrialDemoSeed）。窗口 1440×900。
// 起点是 2026-10 顾问审查时的脚本（D-028）。退出码：0 通过；1 有数字增加；2 脚本出错。
"use strict";
const fs = require("fs");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const flag = (name) => args.includes("--" + name);
const URL_BASE = opt("url", process.env.TRIAL_URL || "http://127.0.0.1:8766/");
const THEMES = opt("themes", "pink,tech").split(",");
const ALL_ROUTES = ["dashboard", "customers", "opportunities", "opp-flows", "order-list", "products", "chats", "team-goals", "analysis", "settings", "settings-hub", "roles", "members", "mail", "rates", "doc-templates"];
const ROUTES = opt("routes", "") ? opt("routes", "").split(",") : ALL_ROUTES;
const BASELINE = path.join(__dirname, "census-baseline.json");
const DIALOGS = [
  ["customers", ".split-new .primary, .split-new .k-btn--primary", "dlg-new-customer"],
  ["order-list", 'button:has-text("新建订单")', "dlg-new-order"],
  ["opportunities", '[data-opp-action="new"]', "dlg-new-opp"],
];

// 在页面里运行：返回每一类样式 → 出现次数
function census() {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const els = [...document.querySelectorAll("#app *, #overlay-root *")].filter(vis);
  const bump = (m, k) => { m[k] = (m[k] || 0) + 1; };
  const out = { fontSize: {}, fontWeight: {}, textColor: {}, radius: {}, shadow: {}, button: {}, input: {}, th: {}, heading: {}, under12: {} };
  for (const e of els) {
    const s = getComputedStyle(e);
    if (s.borderRadius && s.borderRadius !== "0px") bump(out.radius, s.borderRadius);
    if (s.boxShadow && s.boxShadow !== "none") bump(out.shadow, s.boxShadow);
    const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasText) {
      bump(out.fontSize, s.fontSize); bump(out.fontWeight, s.fontWeight); bump(out.textColor, s.color);
      if (parseFloat(s.fontSize) < 12) bump(out.under12, s.fontSize + " " + (e.className && e.className.toString ? e.className.toString().split(" ")[0] : e.tagName));
    }
    if (e.matches("button, [role=button], a.button, .btn") && !e.closest(".rail")) {
      const r = e.getBoundingClientRect();
      bump(out.button, [Math.round(r.height) + "h", s.fontSize, s.fontWeight, s.borderRadius, s.backgroundColor, s.borderTopColor + "/" + s.borderTopWidth, s.color].join(" | "));
    }
    if (e.matches('input:not([type=checkbox]):not([type=radio]), select, textarea, .cs-trigger, [class*="select-trigger"], [class*="dropdown-trigger"]')) {
      const r = e.getBoundingClientRect();
      bump(out.input, [Math.round(r.height) + "h", s.fontSize, s.borderRadius, s.borderTopColor + "/" + s.borderTopWidth, s.backgroundColor].join(" | "));
    }
    if (e.matches("th")) {
      const r = e.getBoundingClientRect();
      bump(out.th, [Math.round(r.height) + "h", s.fontSize, s.fontWeight, s.color, s.backgroundColor, s.padding, s.borderBottomColor].join(" | "));
    }
    if (e.matches("h1,h2,h3,h4")) bump(out.heading, e.tagName + " " + s.fontSize + " " + s.fontWeight + " " + s.color);
  }
  return out;
}

async function seed(page, theme) {
  await page.goto(URL_BASE);
  await page.waitForSelector(".rail-item", { timeout: 30000 });
  await page.evaluate((th) => {
    const s = window.LaiWebTrialDemoSeed.build(new Date());
    const d = s.data || s;
    d.laiSettings = Object.assign({}, d.laiSettings, { theme: th });
    window.LaiWebTrial.restore(JSON.stringify(s));
  }, theme);
}
async function openRoute(page, route) {
  await page.goto("about:blank");
  await page.goto(URL_BASE + "#" + route);
  await page.waitForSelector(".rail-item", { timeout: 30000 });
  await page.waitForTimeout(700);
}
const merge = (into, part) => { for (const k of Object.keys(part)) { into[k] = into[k] || {}; for (const [v, n] of Object.entries(part[k])) into[k][v] = (into[k][v] || 0) + n; } };
// 摘要：每一类有几种；under12 是 12px 以下的文字节点总数
const summarize = (all) => {
  const s = {};
  for (const [k, m] of Object.entries(all)) s[k] = k === "under12" ? Object.values(m).reduce((a, b) => a + b, 0) : Object.keys(m).length;
  return s;
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const result = { summary: {}, detail: {} };
  try {
    for (const theme of THEMES) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await seed(page, theme);
      const all = {};
      for (const route of ROUTES) { await openRoute(page, route); merge(all, await page.evaluate(census)); }
      if (!opt("routes", "")) {
        await openRoute(page, "customers");
        await page.locator("button.company-link").first().click();
        await page.waitForTimeout(900);
        merge(all, await page.evaluate(census));
        for (const [route, sel] of DIALOGS) {
          await openRoute(page, route);
          await page.locator(sel).first().click();
          await page.waitForTimeout(700);
          merge(all, await page.evaluate(census));
        }
      }
      await ctx.close();
      result.summary[theme] = summarize(all);
      result.detail[theme] = all;
    }
  } finally { await browser.close(); }

  const out = opt("out", "");
  if (out) fs.writeFileSync(out, JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result.summary, null, 1));

  if (flag("write-baseline")) {
    fs.writeFileSync(BASELINE, JSON.stringify({ note: "每个主题在 1440×900 下：各类样式有几种（under12 是 12px 以下的文字节点数）。只能变少；scripts/ui-audit/census.cjs --check 检查。", summary: result.summary }, null, 1) + "\n");
    console.log("基线已写入 " + BASELINE);
  }
  if (flag("check")) {
    if (opt("routes", "")) { console.error("--check 需要扫全部页面，不能带 --routes"); process.exit(2); }
    const base = JSON.parse(fs.readFileSync(BASELINE, "utf8")).summary;
    const worse = [];
    for (const [theme, s] of Object.entries(result.summary)) for (const [k, n] of Object.entries(s)) {
      const b = base[theme] && base[theme][k];
      if (typeof b === "number" && n > b) worse.push(`${theme} ${k}: ${b} → ${n}`);
    }
    if (worse.length) { console.error("比基线多：\n  " + worse.join("\n  ")); process.exit(1); }
    console.log("没有比基线多的项目。");
  }
})().catch((e) => { console.error(e); process.exit(2); });
