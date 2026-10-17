// 重叠扫描的共用部分：overlap-sweep.cjs（命令行）和 tests/e2e/overlap-sweep.e2e.mjs（自动测试）都用它。
// 检查本身在 overlap-checks.js（页面内执行，也含白名单）；这里负责「怎么逐页打开、换主题、换窗口大小、打开弹窗」。
// 不依赖 playwright：调用方把已经打开应用的 page 传进来。
"use strict";
const fs = require("fs");
const path = require("path");

const CHECKS = fs.readFileSync(path.join(__dirname, "overlap-checks.js"), "utf8");

// ui-audit 扫的 19 个页面；扫描时还会加上左侧菜单（LaiRailMenu）和 LaiExtraPages 里登记的其他页面。
const BASE_ROUTES = ["customers", "dashboard", "mail", "opportunities", "opp-analysis", "opp-flows", "order-list", "order-trash", "team-goals", "team-targets", "team-wall", "analysis", "team-assets", "team-followups", "team-tasks", "team-orders", "calendar", "settings", "settings-hub"];
// 客户页里的子页面（点左侧二级导航）
const CUSTOMER_SCREENS = ["pool", "duplicates", "customer-settings", "trash"];
// 弹窗／抽屉：[打开前先去的页面, 按钮选择器, 名字]
const DIALOGS = [
  ["order-list", 'button:has-text("新建订单")', "新建订单"],
  ["opportunities", '[data-opp-action="new"]', "新建商机"],
  ["opportunities", ".opp-card-name", "商机详情"],
  ["customers", ".split-new .primary", "新建客户"],
  ["leads", '[data-lead-action="new"]', "新建线索"],
  ["customers", '[data-action="version-history"]', "版本记录"],
  ["customers", '[data-action="about"]', "帮助"],
];
// 点开后才出现的小浮层（菜单、下拉、悬停菜单）：[先去的页面, 选择器, 名字, 'click'|'hover']。只检查刚冒出来的那一块（浮层压住它下面的页面是故意的）。
const POPOVERS = [
  ["customers", '[data-action="global-search-scope"]', "搜索范围菜单"],
  ["customers", 'button.text-button[data-action="new"]', "快速新建菜单"],
  ["customers", '[data-action="profile-menu"]', "账号菜单"],
  ["customers", '[data-action="create-menu"]', "新建客户菜单"],
  ["customers", ".lai-select-trigger", "部门业务员下拉"],
  ["customers", ".customer-table tbody .row-more", "客户行操作菜单"],
  ["order-list", ".lai-select-trigger", "订单筛选下拉"],
  ["customers", '.rail-item[data-rail-menu="交易"]', "左栏悬停菜单", "hover"],
];
const THEMES = ["pink", "orange", "xiaoman", "tech"];
const WIDTHS = [1024, 1152, 1200, 1280, 1366, 1440, 1680, 1920];
// 默认窗口：每个宽度配 800 高，再加 1440×900
const defaultSizes = (widths = WIDTHS) => [...widths.map((w) => [w, 800]), ...(widths.includes(1440) ? [[1440, 900]] : [])];

/** 页面里能找到的全部路由（ui-audit 的 19 个 + 左侧菜单 + 其他模块登记的页面），去重。 */
async function discoverRoutes(page) {
  const found = await page.evaluate(() => {
    const out = [];
    try { for (const e of window.LaiRailMenu.favoritable()) if (e.kind === "route") out.push(e.target); } catch (_) { /* 老版本没有 */ }
    try { out.push(...Object.keys(window.LaiExtraPages || {})); } catch (_) { /* 无 */ }
    return out;
  });
  return [...new Set([...BASE_ROUTES, ...found])];
}

// 先把鼠标挪到角落：鼠标停在某一行上会出现悬停才有的按钮，扫到的就不是静止状态的页面了。
const settle = async (page, ms = 120) => { await page.mouse.move(0, 0); return settleWait(page, ms); };
const settleWait = (page, ms) => page.evaluate((t) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, t)))), ms);

// 浮层：点之前记下页面上所有元素，点之后新冒出来的最外层元素就是浮层，只检查它们。
const snapshotElements = (page) => page.evaluate(() => { window.__sweepPre = new WeakSet(document.querySelectorAll("*")); });
const markNew = (page) => page.evaluate(() => {
  document.querySelectorAll("[data-sweep-scope]").forEach((e) => e.removeAttribute("data-sweep-scope"));
  let n = 0;
  for (const e of document.querySelectorAll("*")) if (!window.__sweepPre.has(e) && e.parentElement && window.__sweepPre.has(e.parentElement)) { e.setAttribute("data-sweep-scope", "1"); n++; }
  return n;
});

// 页面里的标签／分段切换（看板|列表、按月|按季度、结果目标|过程目标……）：把每个没选中的按钮点一遍，每种状态都扫。
// 找法不依赖具体页面：类名里带 tabs／seg／switch／toggle 的容器，直接子按钮 2 个以上。
const TAB_GROUPS = '[role=tablist], [class*="tabs"], [class*="seg"], [class*="switch"], [class*="toggle"]';
const tagTabs = (page) => page.evaluate((groups) => {
  document.querySelectorAll("[data-sweep-tab]").forEach((e) => e.removeAttribute("data-sweep-tab"));
  const out = [];
  let gi = 0;
  for (const g of document.querySelectorAll(groups)) {
    if (g.closest(".rail, #overlay-root")) continue;
    const bs = [...g.children].filter((e) => e.tagName === "BUTTON" && !e.disabled && e.getBoundingClientRect().width > 0);
    if (bs.length < 2) continue;
    bs.forEach((b, bi) => {
      const on = /(^|[\s_-])(active|on|selected|current)([\s_-]|$)/.test(String(b.className)) || b.getAttribute("aria-selected") === "true" || b.getAttribute("aria-pressed") === "true";
      if (on) return;
      b.setAttribute("data-sweep-tab", gi + ":" + bi);
      out.push({ id: gi + ":" + bi, label: b.textContent.trim().replace(/\d+$/, "").slice(0, 8) });
    });
    gi++;
  }
  return out;
}, TAB_GROUPS);

/**
 * 压力数据（只用于网页试用版，需要 LaiWebTrialDemoSeed）：把示例里的公司名、联系人名、产品名都拉长，
 * 真实客户常常是「Shenzhen Hongxin Lashes International Trading Co., Ltd.」这种长度。扫完再刷新就回到原来的数据。
 * 返回 false 表示这个页面没有试用版数据替身（真实后端），什么也没改。
 */
async function stressData(page, url) {
  const done = await page.evaluate(() => {
    if (!window.LaiWebTrial || !window.LaiWebTrialDemoSeed) return false;
    let text = window.LaiWebTrial.snapshot();
    const longer = (s, tail) => s + tail;
    for (const c of window.LaiWebTrialDemoSeed.companies) {
      text = text.split(JSON.stringify(c.name).slice(1, -1)).join(longer(c.name, " International Trading Co., Ltd. 国际贸易有限公司"));
      text = text.split(JSON.stringify(c.contact).slice(1, -1)).join(longer(c.contact, " Alexandra-Montgomery"));
    }
    window.LaiWebTrial.restore(text);
    return true;
  });
  if (done) { await page.goto(url); await page.waitForSelector(".rail-item", { timeout: 20000 }); }
  return done;
}

/** 不刷新页面切换页面：造一个带 data-lai-route 的按钮点一下，和点左栏入口走同一条路。 */
async function gotoRoute(page, route, wait = 150) {
  await page.evaluate((r) => {
    const b = document.createElement("button");
    b.dataset.laiRoute = r;
    b.style.cssText = "position:fixed;left:-99px;top:-99px;width:1px;height:1px";
    document.body.appendChild(b);
    b.click();
    b.remove();
  }, route);
  await page.waitForFunction((r) => location.hash === "#" + r || location.hash === "#dashboard", route, { timeout: 8000 }).catch(() => {});
  await settle(page, wait);
}
async function gotoScreen(page, screen, wait = 150) {
  await page.evaluate((s) => {
    const b = document.createElement("button");
    b.dataset.laiScreen = s;
    b.style.cssText = "position:fixed;left:-99px;top:-99px;width:1px;height:1px";
    document.body.appendChild(b);
    b.click();
    b.remove();
  }, screen);
  await settle(page, wait);
}
async function setTheme(page, theme) {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
    document.documentElement.dataset.skin = t === "xiaoman" ? "classic" : "glass";
  }, theme);
}
async function themeOk(page, theme) {
  return page.evaluate((t) => document.documentElement.dataset.theme === t, theme);
}

/** 跑一次检查。scope 为 null 查整页，或给选择器（弹窗用 "#overlay-root"）。 */
async function check(page, scope) {
  return page.evaluate(`(${CHECKS})(${JSON.stringify({ scope: scope || null })})`);
}

/**
 * 在当前窗口大小和主题下扫一遍所有页面。返回扁平的问题列表：
 *   { route, theme, size, kind: 'overlap'|'clipped'|'offscreen', a, b?, ... }
 * opts: { theme, routes, screens (true), detail (true), dialogs (DIALOGS 或 false), onView(name, result) }
 */
async function sweepView(page, opts) {
  const { theme, routes, screens = true, detail = true, dialogs = DIALOGS, popovers = POPOVERS, tabs: tabsToo = true, onView } = opts;
  const vp = page.viewportSize();
  const size = `${vp.width}x${vp.height}`;
  const findings = [];
  const counts = { views: 0, candidates: 0, allowed: {}, samples: {} };
  // 点一遍当前页面（route 为空时就是当前状态：客户详情）里没选中的标签，每个状态扫一次，然后用 back() 回到原状态
  const walkTabs = async (name, back) => {
    const tabs = (await tagTabs(page)).slice(0, 8);
    for (const tab of tabs) {
      await back();
      await tagTabs(page);
      const el = page.locator(`[data-sweep-tab="${tab.id}"]`).first();
      if (!(await el.count())) continue;
      try { await el.click({ timeout: 2000 }); await settle(page, 300); await record(`${name}#${tab.label}`); } catch (_) { /* 点不到就跳过 */ }
    }
    if (tabs.length) await back();
  };
  const record = async (name, scope) => {
    if (!(await themeOk(page, theme))) { await setTheme(page, theme); await settle(page, 200); }
    const res = await check(page, scope);
    counts.views++;
    counts.candidates += res.counts.candidates;
    for (const [k, n] of Object.entries(res.allowed)) counts.allowed[k] = (counts.allowed[k] || 0) + n;
    for (const [k, v] of Object.entries(res.samples)) { const smp = (counts.samples[k] = counts.samples[k] || []); for (const x of v) if (smp.length < 4 && !smp.includes(x)) smp.push(x); }
    for (const kind of ["overlap", "clipped", "offscreen"]) for (const f of res[kind]) findings.push({ route: name, theme, size, kind, ...f });
    if (onView) onView(name, res);
  };
  for (const route of routes) {
    await gotoRoute(page, route);
    await record(route);
    if (tabsToo) await walkTabs(route, () => gotoRoute(page, route));
    if (route === "customers") {
      if (screens) {
        for (const scr of CUSTOMER_SCREENS) {
          await gotoScreen(page, scr);
          await record("customers/" + scr);
        }
        await gotoRoute(page, "customers");
      }
      if (detail) {
        const openDetail = async () => {
          await gotoRoute(page, "customers");
          const link = page.locator(".customer-table tbody tr .company-link, .customer-table tbody tr button").first();
          if (!(await link.count())) return false;
          await link.click({ timeout: 3000 });
          await settle(page, 700);
          return true;
        };
        try {
          if (await openDetail()) {
            await record("customer-detail");
            if (tabsToo) await walkTabs("customer-detail", openDetail);
          }
        } catch (_) { /* 点不到就跳过 */ }
      }
    }
  }
  if (dialogs) {
    for (const [route, sel, name] of dialogs) {
      await gotoRoute(page, route);
      const el = page.locator(sel).first();
      if (!(await el.count())) continue;
      try { await el.click({ timeout: 2000 }); await settle(page, 600); await record("弹窗 " + name, "#overlay-root"); } catch (_) { /* 打不开就跳过 */ }
      await page.keyboard.press("Escape"); // 不关掉的话，后面切页面的点击会被弹窗拦住
      await settle(page, 100);
    }
    await gotoRoute(page, "customers");
  }
  if (popovers) {
    for (const [route, sel, name, mode] of popovers) {
      await gotoRoute(page, route);
      const el = page.locator(sel).first();
      if (!(await el.count())) continue;
      await snapshotElements(page);
      try { if (mode === "hover") await el.hover({ timeout: 2000 }); else await el.click({ timeout: 2000 }); } catch (_) { continue; }
      await settleWait(page, 400);
      if (await markNew(page)) await record("浮层 " + name, "[data-sweep-scope]");
      await page.keyboard.press("Escape");
      await settle(page, 100);
    }
    await gotoRoute(page, "customers");
  }
  return { findings, counts };
}

/** 一条问题的「签名」：同一处问题在不同窗口大小、主题下合并成一行。 */
function signature(f) {
  const strip = (s) => String(s || "");
  if (f.kind === "overlap") return [f.kind, f.route, strip(f.a.sel), strip(f.a.text), strip(f.b.sel), strip(f.b.text)].join("|");
  return [f.kind, f.route, strip(f.sel), strip(f.text)].join("|");
}
function group(findings) {
  const map = new Map();
  for (const f of findings) {
    const key = signature(f);
    let g = map.get(key);
    if (!g) { g = { key, kind: f.kind, route: f.route, first: f, where: new Set() }; map.set(key, g); }
    g.where.add(`${f.theme} ${f.size}`);
  }
  return [...map.values()].map((g) => ({ ...g, where: [...g.where] }));
}
function describe(f) {
  if (f.kind === "overlap") return `${f.a.sel} 「${f.a.text}」 压住 ${f.b.sel} 「${f.b.text}」 ${JSON.stringify(f.inter)}`;
  return `${f.sel} 「${f.text}」 ${f.how} ${JSON.stringify(f.box)}`;
}
/** 命令行／测试失败信息用的文字摘要（每组最多 limit 条）。 */
function summarize(findings, limit = 30) {
  const groups = group(findings);
  const byKind = {}, byRoute = {};
  for (const f of findings) { byKind[f.kind] = (byKind[f.kind] || 0) + 1; byRoute[f.route] = (byRoute[f.route] || 0) + 1; }
  const lines = [`共 ${findings.length} 处（${groups.length} 种）；` + Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join("，")];
  for (const g of groups.slice(0, limit)) lines.push(`  [${g.kind}] ${g.route}  ${describe(g.first)}  @ ${g.where.slice(0, 4).join("; ")}${g.where.length > 4 ? ` 等 ${g.where.length} 处` : ""}`);
  if (groups.length > limit) lines.push(`  …还有 ${groups.length - limit} 种`);
  return lines.join("\n");
}

module.exports = { stressData, CHECKS, BASE_ROUTES, CUSTOMER_SCREENS, DIALOGS, POPOVERS, THEMES, WIDTHS, defaultSizes, discoverRoutes, gotoRoute, gotoScreen, setTheme, themeOk, check, sweepView, signature, group, summarize, describe, settle };
