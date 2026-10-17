// 重叠扫描：每个页面、每个主题、每种窗口宽度（1024～1920）下，找「互相压住」「文字被切掉没有省略号」「伸出窗口」。
// 为什么单独做：ui-audit.cjs 只扫 3 种窗口，而且只看元素自己的中心点是不是在最上层，只压住一半的重叠发现不了
// （顶栏搜索框在 1150～1270px 宽时压住版本标签，就是这样漏掉的）。
//
//   node scripts/web-trial/serve.cjs /path/to/lai-web.html 8791 &
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core node scripts/ui-audit/overlap-sweep.cjs [选项]
//
// 选项（都可省略）：
//   --url http://127.0.0.1:8791/       网页试用版地址（自带示例数据）
//   --themes pink,orange,tech  要扫的主题
//   --widths 1024,1152,1200,...        窗口宽度（默认 1024,1152,1200,1280,1366,1440,1680,1920，高 800；1440 再加一个高 900）
//   --sizes 1440x900,1280x720          直接给完整尺寸，优先于 --widths
//   --routes customers,order-list,...  只扫这几页（默认：全部页面）
//   --no-dialogs                       不开弹窗和小菜单
//   --no-tabs                          不点页面里的标签切换（快很多，但少看很多状态）
//   --stress                           先把示例数据里的公司名、联系人名拉长（真实客户名常常很长），再扫（只对网页试用版有效）
//   --workers 4                        同时开几个浏览器页（默认 4）
//   --out DIR                          报告目录（默认系统临时目录），里面的 overlap-report.json 有每一处的详情
//   --fail                             有任何问题就以退出码 1 结束（默认只报告）
//
// 判定和白名单在 overlap-checks.js（白名单每条写了原因）。需要 playwright-core（装在仓库之外）和 Chromium（CHROMIUM 环境变量）。
// 退出码：0 正常（或没加 --fail）；1 加了 --fail 且有问题；2 脚本出错。
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const lib = require("./overlap-sweep-lib.cjs");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const flag = (name) => args.includes("--" + name);

const URL_BASE = opt("url", process.env.TRIAL_URL || "http://127.0.0.1:8766/");
const THEMES = opt("themes", lib.THEMES.join(",")).split(",");
const SIZES = opt("sizes", "")
  ? opt("sizes", "").split(",").map((v) => v.split("x").map(Number))
  : lib.defaultSizes(opt("widths", "") ? opt("widths", "").split(",").map(Number) : lib.WIDTHS);
const WORKERS = Math.max(1, Number(opt("workers", "4")));
const OUT = opt("out", "") || fs.mkdtempSync(path.join(os.tmpdir(), "overlap-sweep-"));
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const t0 = Date.now();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const jobs = [];
  for (const theme of THEMES) for (const [w, h] of SIZES) jobs.push({ theme, w, h });
  const findings = [], errors = [];
  const counts = { views: 0, candidates: 0, allowed: {}, samples: {} };
  let routes;
  try {
    const probe = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await probe.goto(URL_BASE);
    await probe.waitForSelector(".rail-item", { timeout: 20000 });
    routes = opt("routes", "") ? opt("routes", "").split(",") : await lib.discoverRoutes(probe);
    await probe.close();
    const worker = async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("dialog", (d) => d.dismiss().catch(() => {}));
      await page.goto(URL_BASE);
      await page.waitForSelector(".rail-item", { timeout: 20000 });
      if (flag("stress")) await lib.stressData(page, URL_BASE);
      for (let job = jobs.shift(); job; job = jobs.shift()) {
        await page.setViewportSize({ width: job.w, height: job.h });
        await lib.setTheme(page, job.theme);
        await lib.settle(page, 250);
        const r = await lib.sweepView(page, { theme: job.theme, routes, dialogs: flag("no-dialogs") ? false : lib.DIALOGS, popovers: flag("no-dialogs") ? false : lib.POPOVERS, tabs: !flag("no-tabs") });
        findings.push(...r.findings);
        counts.views += r.counts.views;
        counts.candidates += r.counts.candidates;
        for (const [k, n] of Object.entries(r.counts.allowed)) counts.allowed[k] = (counts.allowed[k] || 0) + n;
        for (const [k, v] of Object.entries(r.counts.samples)) { const smp = (counts.samples[k] = counts.samples[k] || []); for (const x of v) if (smp.length < 4 && !smp.includes(x)) smp.push(x); }
        process.stderr.write(`.${job.theme}/${job.w}x${job.h}:${r.findings.length} `);
      }
      await page.close();
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));
  } catch (e) {
    console.error("\n扫描脚本出错：", e.stack || e.message);
    await browser.close();
    process.exit(2);
  }
  await browser.close();
  const seconds = (Date.now() - t0) / 1000;
  process.stderr.write("\n");

  const groups = lib.group(findings);
  findings.sort((a, b) => (a.route + a.theme + a.size).localeCompare(b.route + b.theme + b.size));
  const report = { when: new Date().toISOString(), url: URL_BASE, themes: THEMES, sizes: SIZES.map((s) => s.join("x")), routes, seconds, counts, total: findings.length, unique: groups.length, groups: groups.map((g) => ({ kind: g.kind, route: g.route, where: g.where, first: g.first })), findings, pageErrors: errors };
  fs.writeFileSync(path.join(OUT, "overlap-report.json"), JSON.stringify(report, null, 1));

  // ---- 摘要表：种类 × 页面 ----
  const table = {};
  for (const g of groups) { table[g.route] = table[g.route] || { overlap: 0, clipped: 0, offscreen: 0 }; table[g.route][g.kind]++; }
  console.log(`报告：${path.join(OUT, "overlap-report.json")}`);
  console.log(`用时 ${seconds.toFixed(1)} 秒；${counts.views} 个页面视图；${THEMES.length} 个主题 × ${SIZES.length} 种窗口；共 ${counts.candidates} 个小元素`);
  console.log(`问题：${findings.length} 处，合并后 ${groups.length} 种（同一处在不同窗口、主题下只算一种）`);
  console.log(`页面报错：${errors.length}`);
  console.log("\n页面".padEnd(28) + "重叠  切字  伸出");
  for (const [route, c] of Object.entries(table).sort()) console.log(route.padEnd(26) + String(c.overlap).padStart(4) + String(c.clipped).padStart(6) + String(c.offscreen).padStart(6));
  console.log("\n被白名单放过的（按规则）：" + (Object.keys(counts.allowed).length ? JSON.stringify(counts.allowed) : "无"));
  for (const [k, v] of Object.entries(counts.samples)) console.log(`  ${k}：${v.join("；")}`);
  for (const g of groups.slice(0, 80)) console.log(`  [${g.kind}] ${g.route}  ${lib.describe(g.first)}  @ ${g.where.slice(0, 3).join("; ")}${g.where.length > 3 ? ` 等 ${g.where.length} 处` : ""}`);
  if (groups.length > 80) console.log(`  …还有 ${groups.length - 80} 种，见报告`);
  const failed = flag("fail") && (findings.length > 0 || errors.length > 0);
  console.log(failed ? "结果：有问题" : findings.length ? "结果：有问题（未加 --fail，仅报告）" : "结果：通过");
  process.exit(failed ? 1 : 0);
})();
