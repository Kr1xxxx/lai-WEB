// 界面扫描：遮挡、下拉框样式种类、点击前后字体变化。每次改界面、发布网页试用版前跑一次。
//
//   node scripts/web-trial/serve.cjs /path/to/lai-web.html &
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core node scripts/ui-audit/ui-audit.cjs [选项]
//
// 选项（都可省略）：
//   --url http://127.0.0.1:8766/      网页试用版地址（需要它自带的示例数据 LaiWebTrialDemoSeed）
//   --themes pink,orange,xiaoman,tech  要扫的主题
//   --views 1440x900,1280x720,1440x640  窗口尺寸
//   --routes customers,order-list,... 只扫这几页（默认全部）
//   --no-font                         跳过「点击前后字体」检查（比较慢）
//   --out DIR                         报告目录（默认系统临时目录）
//   --baseline FILE                   和已有基线比较，问题数增加就失败（默认 scripts/ui-audit/baseline.json，存在时才比较）
//   --write-baseline                  把这次的结果写成新的基线（只在确认现有问题都是已知、可接受时用）
//
// 需要 playwright-core（装在仓库之外）和 Chromium（CHROMIUM 环境变量，默认 /opt/pw-browsers/chromium）。
// 退出码：0 通过；1 有新增问题；2 脚本自己出错。
// 检查什么、怎么判断，见 UI_CHECKLIST.md。
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const flag = (name) => args.includes("--" + name);

const URL_BASE = opt("url", process.env.TRIAL_URL || "http://127.0.0.1:8766/");
const THEMES = opt("themes", "pink,orange,xiaoman,tech").split(",");
const VIEWS = opt("views", "1440x900,1280x720,1440x640").split(",").map((v) => v.split("x").map(Number));
const ALL_ROUTES = ["customers", "dashboard", "mail", "opportunities", "opp-analysis", "opp-flows", "order-list", "order-trash", "team-goals", "team-targets", "team-wall", "analysis", "team-assets", "team-followups", "team-tasks", "team-orders", "calendar", "settings", "settings-hub"];
const ROUTES = opt("routes", "") ? opt("routes", "").split(",") : ALL_ROUTES;
const OUT = opt("out", "") || fs.mkdtempSync(path.join(os.tmpdir(), "ui-audit-"));
fs.mkdirSync(OUT, { recursive: true });
const BASELINE = opt("baseline", path.join(__dirname, "baseline.json"));
const PAGE_CHECKS = fs.readFileSync(path.join(__dirname, "page-checks.js"), "utf8");

// 弹窗／抽屉：只在最大尺寸下开一遍
const DIALOGS = [
  ["order-list", 'button:has-text("新建订单")', "新建订单"],
  ["opportunities", '[data-opp-action="new"]', "新建商机"],
  ["customers", ".split-new .primary", "新建客户"],
  ["calendar", '[data-action="new-task"]', "新建日程"],
];

// 点击前后要比较的控件：下拉、带弹出的按钮、各种输入框
const MARK_JS = `()=>{const vis=e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>2&&r.height>2&&s.visibility!=='hidden'&&s.display!=='none'&&r.top<innerHeight&&r.top>0};
 const t=[...document.querySelectorAll('select, [aria-haspopup], [aria-expanded], [class*="select"]:is(button), [class*="dropdown"]:is(button), [class*="filter"]:is(button), input[type=date], input[type=search], input[type=text]')].filter(e=>vis(e)&&!e.matches('.rail-item, .lcd-info-toggle'));
 t.forEach((e,i)=>e.setAttribute('data-fp',i));return t.length}`;
const SNAP_JS = `(i)=>{const e=document.querySelector('[data-fp="'+i+'"]');if(!e)return null;const leaf=[...e.querySelectorAll('*')].find(x=>!x.children.length&&x.textContent.trim())||e;
 const f=x=>{const s=getComputedStyle(x);return [s.fontSize,s.fontWeight,s.fontFamily.split(',')[0],s.letterSpacing,s.lineHeight,s.fontStyle].join('|')};const r=e.getBoundingClientRect();
 const probe=document.createElement('i');document.body.appendChild(probe);const brand=['--brand-50','--brand-100','--brand-500','--brand-700','--brand-900'].map(v=>{probe.style.color='var('+v+')';return getComputedStyle(probe).color});probe.remove();
 return {el:f(e),leaf:f(leaf),elColor:getComputedStyle(e).color,leafColor:getComputedStyle(leaf).color,brand,w:Math.round(r.width),h:Math.round(r.height),text:(e.innerText||e.value||e.placeholder||e.getAttribute('aria-label')||'').trim().slice(0,20),tag:e.tagName.toLowerCase(),cls:(typeof e.className==='string'?e.className:'').slice(0,40)}}`;
async function seed(page, theme) {
  await page.goto(URL_BASE);
  await page.waitForSelector(".rail-item", { timeout: 20000 });
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
  await page.waitForSelector(".rail-item", { timeout: 20000 });
  await page.waitForTimeout(700);
}
const isRail = (x) => /rail/.test(x.el) || /rail/.test(x.by);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const pages = []; // 每页一条：{key, covered, spill, dd}
  const fontDiffs = [];
  const errors = [];
  try {
    for (const theme of THEMES) {
      for (const [w, h] of VIEWS) {
        const page = await browser.newPage({ viewport: { width: w, height: h } });
        page.on("pageerror", (e) => errors.push(`${theme} ${w}x${h}: ${e.message}`));
        page.on("dialog", (d) => d.dismiss().catch(() => {}));
        await seed(page, theme);
        const record = async (name, scope) => {
          const out = await page.evaluate(`(${PAGE_CHECKS})(${JSON.stringify(scope || null)})`);
          pages.push({ key: `${theme}|${w}x${h}|${name}`, theme, name, covered: out.covered.filter((x) => !isRail(x)), railCovered: out.covered.filter(isRail).length, spill: out.spill, dd: out.dd });
        };
        for (const route of ROUTES) {
          await openRoute(page, route);
          await record(route);
          if (route === "customers") {
            for (const scr of ["pool", "duplicates", "customer-settings"]) {
              const el = page.locator(`[data-lai-screen="${scr}"]`).first();
              if (await el.count()) { await el.click(); await page.waitForTimeout(500); await record("customers/" + scr); }
            }
            await openRoute(page, "customers");
            const link = page.locator(".customer-table tbody tr .company-link, .customer-table tbody tr button").first();
            if (await link.count()) { await link.click(); await page.waitForTimeout(900); await record("customer-detail"); }
          }
        }
        if (w === VIEWS[0][0] && h === VIEWS[0][1]) {
          for (const [route, sel, name] of DIALOGS) {
            await openRoute(page, route);
            const el = page.locator(sel).first();
            if (!(await el.count())) continue;
            try { await el.click({ timeout: 3000 }); await page.waitForTimeout(700); await record("弹窗 " + name, "#overlay-root"); } catch (_) {}
          }
        }
        await page.close();
      }
    }
    // 点击前后字体：只在最大尺寸、每个主题各跑一遍
    if (!flag("no-font")) {
      const [w, h] = VIEWS[0];
      for (const theme of THEMES) {
        const page = await browser.newPage({ viewport: { width: w, height: h } });
        page.on("dialog", (d) => d.dismiss().catch(() => {}));
        await seed(page, theme);
        for (const route of ROUTES) {
          await openRoute(page, route);
          const n = await page.evaluate(`(${MARK_JS})()`);
          for (let i = 0; i < Math.min(n, 30); i++) {
            await page.mouse.move(0, 0);
            const before = await page.evaluate(`(${SNAP_JS})(${i})`);
            if (!before) continue;
            try { await page.locator(`[data-fp="${i}"]`).click({ timeout: 1500 }); } catch (_) { continue; }
            await page.waitForTimeout(250);
            const during = await page.evaluate(`(${SNAP_JS})(${i})`);
            let typed = null;
            if (before.tag === "input") { await page.keyboard.type("Ab"); await page.waitForTimeout(100); typed = await page.evaluate(`(${SNAP_JS})(${i})`); }
            await page.keyboard.press("Escape");
            await page.mouse.move(0, 0); // 鼠标还停在控件上会显示悬停色，不算变样
            await page.waitForTimeout(150);
            const after = await page.evaluate(`(${SNAP_JS})(${i})`);
            const diff = {};
            for (const [k, v] of [["点开时", during], ["输入后", typed], ["关闭后", after]])
              if (v && v.tag === before.tag && v.cls === before.cls)
              {
                for (const f of ["el", "leaf", "w", "h"]) if (v[f] !== before[f]) diff[k + "." + f] = [before[f], v[f]];
                // 字色变化只允许变成主题主色（选中、展开的约定表现），变灰、变淡都算
                for (const f of ["elColor", "leafColor"]) if (v[f] !== before[f] && !before.brand.includes(v[f])) diff[k + "." + f] = [before[f], v[f]];
              }
            // 点击后控件自己消失（例如收起按钮）不算变样
            const vanished = Object.entries(diff).every(([, [, b]]) => b === 0);
            if (Object.keys(diff).length && !vanished) fontDiffs.push({ theme, page: route, text: before.text, tag: before.tag, cls: before.cls, diff });
            if ((await page.evaluate("location.hash")) !== "#" + route || (await page.locator("#overlay-root .overlay").count())) {
              await openRoute(page, route);
              await page.evaluate(`(${MARK_JS})()`);
            }
          }
        }
        await page.close();
      }
    }
  } catch (e) {
    console.error("扫描脚本出错：", e.message);
    await browser.close();
    process.exit(2);
  }
  await browser.close();

  // ---- 汇总 ----
  const nativeSelects = pages.flatMap((p) => p.dd.filter((d) => d.tag === "select").map((d) => `${p.key}  ${d.el}`));
  const sig = (d) => `${d.h}高 ${d.fs} 字重${d.fw} 圆角${d.rad} 箭头${d.arrow}`;
  const triggerStyles = {};
  for (const p of pages) {
    triggerStyles[p.theme] = triggerStyles[p.theme] || {};
    for (const d of p.dd) if (/lai-select-trigger/.test(d.el)) (triggerStyles[p.theme][sig(d)] = triggerStyles[p.theme][sig(d)] || []).push(`${p.name}:${d.text}`);
  }
  const coveredCounts = {};
  for (const p of pages) if (p.covered.length) coveredCounts[p.key] = p.covered.length;
  const report = { when: new Date().toISOString(), url: URL_BASE, themes: THEMES, views: VIEWS.map((v) => v.join("x")), nativeSelects, triggerStyles: Object.fromEntries(Object.entries(triggerStyles).map(([t, m]) => [t, Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.length]))])), coveredCounts, covered: pages.flatMap((p) => p.covered.map((c) => ({ key: p.key, ...c }))), fontDiffs, pageErrors: errors };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));

  const totalCovered = Object.values(coveredCounts).reduce((a, b) => a + b, 0);
  console.log(`报告：${path.join(OUT, "report.json")}`);
  console.log(`页面报错：${errors.length}`);
  console.log(`原生下拉框（应为 0）：${nativeSelects.length}`);
  for (const t of Object.keys(report.triggerStyles)) console.log(`下拉框样式 ${t}：${Object.keys(report.triggerStyles[t]).length} 种 → ${Object.entries(report.triggerStyles[t]).map(([k, v]) => `${k}×${v}`).join("； ")}`);
  console.log(`被遮挡（不含左栏）：${totalCovered} 处；左栏被遮挡：${pages.reduce((a, p) => a + p.railCovered, 0)} 处（应为 0）`);
  console.log(`点击前后字体／尺寸变化：${fontDiffs.length} 处${flag("no-font") ? "（已跳过）" : ""}`);
  for (const f of fontDiffs.slice(0, 10)) console.log("  ", f.theme, f.page, f.text, JSON.stringify(f.diff));

  if (flag("write-baseline")) {
    fs.writeFileSync(BASELINE, JSON.stringify({ coveredCounts, note: "已知、可接受的被遮挡项数量（客户表格冻结的操作列、折叠的客群分组等）；扫描结果比它多就算新增问题。" }, null, 1) + "\n");
    console.log("已写入基线：" + BASELINE);
  }
  let failed = errors.length > 0 || nativeSelects.length > 0 || fontDiffs.length > 0 || pages.some((p) => p.railCovered > 0);
  if (fs.existsSync(BASELINE) && !flag("write-baseline")) {
    const base = JSON.parse(fs.readFileSync(BASELINE, "utf8")).coveredCounts || {};
    const worse = Object.entries(coveredCounts).filter(([k, n]) => n > (base[k] || 0));
    if (worse.length) { failed = true; console.log("比基线多的被遮挡项：", worse.map(([k, n]) => `${k} ${base[k] || 0}→${n}`).join("； ")); }
  }
  console.log(failed ? "结果：有新增问题" : "结果：通过");
  process.exit(failed ? 1 : 0);
})();
