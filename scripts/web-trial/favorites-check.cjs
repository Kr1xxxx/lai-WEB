// Browser walk-through of the 常用 (favorites) hearts on a rebuilt web trial page.
//   node scripts/web-trial/serve.cjs /path/to/lai-web.html &
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core SHOTS=/path/to/shots/ node scripts/web-trial/favorites-check.cjs [width]
// Needs playwright-core (install it outside the repo) and a Chromium binary (CHROMIUM, default /opt/pw-browsers/chromium).
// Screenshots go to SHOTS (must exist, with a trailing slash). Width defaults to 1440.
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const SHOTS = process.env.SHOTS || require('os').tmpdir() + '/';
const URL = process.env.TRIAL_URL || 'http://127.0.0.1:8766/';
const results = [];
const note = (ok, msg) => { results.push([ok, msg]); console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const W = Number(process.argv[2] || 1440);
const tag = String(W);
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('requestfailed', r => errors.push('requestfailed: ' + r.url()));
  const shot = async (name) => {
    await page.screenshot({ path: `${SHOTS}${tag}-${name}.png`, scale: 'css' });
    await page.screenshot({ path: `${SHOTS}${tag}-${name}-zoom.png`, scale: 'device', clip: { x: 0, y: 56, width: 560, height: 560 } });
  };
  const op = sel => page.locator(sel).first().evaluate(el => getComputedStyle(el).opacity);
  const color = sel => page.locator(sel).first().evaluate(el => getComputedStyle(el).color);
  const row = label => `.subnav .nav-row:has(.nav-label:text-is("${label}")), .subnav .nav-row:has(.mail-folder-label:text-is("${label}"))`;
  const heartIn = label => `.subnav .nav-row:has(.nav-label:text-is("${label}")) .nav-heart, .subnav .nav-row:has(.mail-folder-label:text-is("${label}")) .nav-heart`;
  const settle = () => page.waitForTimeout(260);
  const rail = label => { const loc = page.locator(`.rail-item[data-rail-menu="${label}"]`); const scroll = () => loc.evaluate(el => el.scrollIntoView({ block: 'start' })); const wrap = { hover: async () => { await scroll(); await loc.hover(); }, click: async () => { await scroll(); await loc.evaluate(el => el.click()); } }; return wrap; };
  const subnavTitle = () => page.locator('.subnav h3').first().evaluate(el => el.firstChild.textContent.trim());
  const railActive = () => page.locator('.rail-item.active').evaluateAll(els => els.map(e => e.dataset.railMenu));
  const away = async () => { await page.mouse.move(900, 600); await settle(); };

  await page.goto(URL);
  await page.waitForSelector('.subnav .nav-entry');
  // ---- step 1
  const hearts = await page.locator('.subnav .nav-heart').count();
  const anyFav = await page.locator('.subnav .nav-heart.is-favorite').count();
  const ops = await page.locator('.subnav .nav-heart').evaluateAll(els => els.map(e => getComputedStyle(e).opacity));
  note(hearts === 4 && anyFav === 0 && ops.every(o => o === '0'), `1 fresh data: ${hearts} hearts in customer subnav, ${anyFav} favorited, opacities ${ops.join(',')}`);
  await shot('01-fresh-customers');
  // ---- step 2 hover
  await page.hover(row('公海客户'));
  await settle();
  const hoverOp = await op(heartIn('公海客户'));
  const hoverCol = await color(heartIn('公海客户'));
  const otherOp = await op(heartIn('客户查重'));
  note(hoverOp === '1' && otherOp === '0', `2 hover row: heart opacity ${hoverOp} (color ${hoverCol}), other row ${otherOp}`);
  await shot('02a-hover-row');
  await page.hover(heartIn('公海客户'));
  await settle();
  const heartHoverCol = await color(heartIn('公海客户'));
  note(heartHoverCol !== hoverCol, `2 hover heart: color ${hoverCol} -> ${heartHoverCol}`);
  await shot('02b-hover-heart');
  await away();
  note((await op(heartIn('公海客户'))) === '0', '2 mouse away: heart hidden again');
  await page.hover(row('客户列表'));
  await settle();
  await shot('02c-hover-active-row');
  await page.hover(heartIn('客户列表'));
  await settle();
  await shot('02d-hover-heart-on-active-row');
  // ---- step 3 click
  await page.click(heartIn('客户列表'));
  await settle();
  note(await page.locator(heartIn('客户列表')).evaluate(el => el.classList.contains('is-favorite') && el.getAttribute('aria-label') === '取消常用：客户列表'), '3 click: heart is-favorite, label 取消常用：客户列表');
  await away();
  note((await op(heartIn('客户列表'))) === '1', '3 favorite heart stays visible without hover');
  await shot('03a-favorited');
  await page.reload();
  await page.waitForSelector('.subnav .nav-entry');
  note(await page.locator(heartIn('客户列表')).evaluate(el => el.classList.contains('is-favorite')), '3 after reload still favorite');
  await rail('常用').hover();
  await page.waitForSelector('.rail-flyout');
  const flyoutItems = await page.locator('.rail-flyout-item').allInnerTexts();
  note(flyoutItems.join('|') === '客户列表', `3 常用 flyout lists: ${flyoutItems.join('|')}`);
  await shot('03b-favorites-flyout');
  // ---- step 4
  await away();
  await rail('交易').click(); await page.waitForSelector('.subnav h3:text("交易")'); await away();
  await page.hover(row('订单回收站')); await page.click(heartIn('订单回收站')); await settle();
  await shot('04a-trade-favorited');
  await rail('团队数据').click(); await page.waitForSelector('.subnav h3:text("团队数据")'); await away();
  await page.hover(row('订单业绩')); await page.click(heartIn('订单业绩')); await settle();
  await page.hover(row('目标完成情况')); await settle();
  await shot('04b-team-favorited');
  await rail('邮件').click(); await page.waitForSelector('.mail-folders'); await away();
  await page.hover(row('待处理邮件')); await page.click(heartIn('待处理邮件')); await settle();
  await page.hover(row('收件箱')); await settle();
  await shot('04c-mail-favorited');
  const hashBefore = await page.evaluate(() => location.hash);
  await rail('协同').hover(); await page.waitForSelector('.rail-flyout[data-menu="协同"]');
  await page.hover('.rail-flyout-row'); await settle();
  await shot('04d-flyout-hover-row');
  await page.click('.rail-flyout .nav-heart'); await settle();
  const stillOpen = await page.locator('.rail-flyout[data-menu="协同"]').count();
  const hashAfter = await page.evaluate(() => location.hash);
  note(stillOpen === 1 && hashBefore === hashAfter && await page.locator('.rail-flyout .nav-heart').evaluate(el => el.classList.contains('is-favorite')), `4 flyout heart toggles only: flyout still open=${stillOpen}, hash ${hashBefore} -> ${hashAfter}`);
  await shot('04e-flyout-favorited');
  await rail('工作台').hover(); await page.waitForSelector('.rail-flyout[data-menu="工作台"]');
  await page.hover('.rail-flyout-row'); await page.click('.rail-flyout .nav-heart'); await settle();
  await away();
  // ---- step 5
  await rail('常用').click(); await page.waitForSelector('.subnav h3:text("常用")'); await away(); await settle();
  const listed = await page.locator('.subnav [data-favorite-open] .nav-label').allInnerTexts();
  console.log('favorites list:', listed.join(','));
  await shot('05a-favorites-first');
  const mainText = async () => (await page.locator('.main').innerText()).replace(/\s+/g, ' ').slice(0, 80);
  let idx = 0;
  for (const label of listed) {
    await page.click(`.subnav [data-favorite-open] .nav-label:text-is("${label}")`);
    await page.waitForTimeout(500);
    const act = await railActive();
    const hl = await page.locator('.subnav .nav-entry.active .nav-label').allInnerTexts();
    const title = await subnavTitle();
    const ok = act.length === 1 && act[0] === '常用' && title === '常用' && hl.length === 1 && hl[0] === label;
    note(ok, `5 open "${label}": rail active=${act}, subnav title=${title}, highlighted=${hl}, main="${await mainText()}"`);
    await away();
    await shot(`05b-fav-${++idx}-${label}`);
  }
  await rail('交易').click(); await page.waitForSelector('.subnav h3:text("交易")'); await away();
  note((await railActive()).join() === '交易', '5 clicking another rail menu leaves 常用 mode');
  await rail('常用').click(); await page.waitForSelector('.subnav h3:text("常用")'); await away(); await settle();
  // ---- step 6
  const before = await page.locator('.subnav [data-favorite-open]').count();
  await page.hover(row('订单业绩'));
  await page.click(heartIn('订单业绩')); await settle();
  const after = await page.locator('.subnav [data-favorite-open]').count();
  note(after === before - 1 && !(await page.locator('.subnav').innerText()).includes('订单业绩'), `6 remove in list: ${before} -> ${after}`);
  await shot('06a-removed');
  await page.click('[data-action="favorite-nav-manage"]'); await page.waitForSelector('.favorite-nav-list'); await page.waitForTimeout(600);
  await shot('06b-manage');
  const names = async () => page.locator('.favorite-nav-jump').evaluateAll(els => els.map(e => e.firstChild.textContent));
  const n0 = await names();
  await page.click('[data-favorite-move="route:calendar"][data-direction="-1"]'); await settle();
  const n1 = await names();
  await page.click('[data-favorite-move="route:calendar"][data-direction="1"]'); await settle();
  const n2 = await names();
  note(n0.join() !== n1.join() && n0.join() === n2.join(), `6 manage move up/down: ${n0} | ${n1} | ${n2}`);
  await page.click('[data-favorite-remove="route:dashboard"]'); await settle();
  const n3 = await names();
  note(!n3.includes('工作台'), `6 manage remove: ${n3}`);
  await shot('06c-manage-after');
  for (let i = 0; i < 20 && await page.locator('[data-favorite-remove]').count(); i++) { await page.locator('[data-favorite-remove]').first().click(); await settle(); }
  await shot('06d-manage-empty');
  await page.click('.drawer-footer .primary'); await settle();
  // ---- step 7
  await rail('交易').click(); await page.waitForSelector('.subnav h3:text("交易")'); await away();
  await rail('常用').click(); await page.waitForSelector('.favorites-empty'); await away(); await settle();
  note((await page.locator('.main').innerText()).includes('还没有常用导航') && (await railActive()).join() === '常用', `7 empty state: ${await mainText()}`);
  note((await page.locator('.subnav').innerText()).includes('还没有常用导航'), '7 subnav empty hint');
  await shot('07a-empty-state');
  await rail('交易').hover(); await page.waitForSelector('.rail-flyout[data-menu="交易"]');
  await page.hover('.rail-flyout-row'); await page.click('.rail-flyout .nav-heart'); await settle();
  await away();
  const sub = await page.locator('.subnav [data-favorite-open] .nav-label').allInnerTexts();
  note(sub.join() === '全部订单' && (await page.locator('.main').innerText()).includes('从左侧选一项'), `7 empty page updates when a favorite is added from the flyout: ${sub}`);
  await shot('07b-empty-after-add');
  // ---- step 8 keyboard
  await rail('客户').click(); await page.waitForSelector('.subnav [data-lai-screen="pool"]'); await away();
  await away();
  await page.focus('.subnav [data-lai-screen="pool"]');
  await page.keyboard.press('Tab');
  await settle();
  const focused = await page.evaluate(() => document.activeElement?.dataset?.navFavorite);
  const kop = await op(heartIn('公海客户'));
  note(focused === 'screen:pool' && kop === '1', `8 Tab reaches unfavorited heart (focused=${focused}), opacity ${kop}`);
  await shot('08a-keyboard-focus');
  await page.keyboard.press('Enter'); await settle();
  note(await page.locator(heartIn('公海客户')).evaluate(el => el.classList.contains('is-favorite')), '8 Enter toggles heart on');
  note(await page.evaluate(() => document.activeElement?.dataset?.navFavorite) === 'screen:pool', '8 focus stays on heart after toggle');
  await page.keyboard.press('Enter'); await settle();
  note(!(await page.locator(heartIn('公海客户')).evaluate(el => el.classList.contains('is-favorite'))), '8 Enter toggles heart off again');
  for (const label of ['客户', '邮件', '交易', '团队数据', '协同', '企业管理', '工作台']) {
    await rail(label).click(); await away(); await page.waitForTimeout(300);
    const trunc = await page.locator('.subnav .nav-label, .subnav .mail-folder-label').evaluateAll(els => els.filter(e => e.scrollWidth > e.clientWidth + 0.5).map(e => e.textContent));
    note(trunc.length === 0, `layout: ${label} subnav labels truncated: [${trunc}]`);
  }
  await rail('团队数据').click(); await away(); await page.waitForTimeout(300);
  await page.hover(row('目标完成情况')); await settle();
  await shot('08b-team-subnav-hover');
  await rail('团队数据').hover(); await page.waitForSelector('.rail-flyout');
  const wraps = await page.locator('.rail-flyout-item').evaluateAll(els => els.filter(e => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth).map(e => e.textContent));
  note(wraps.length === 0, `layout: flyout items clipped/wrapped: [${wraps}]`);
  await page.hover('.rail-flyout-row:nth-child(1)'); await settle();
  await shot('08c-team-flyout');
  console.log('\nERRORS:', JSON.stringify(errors));
  note(errors.length === 0, `9 page errors: ${errors.length}`);
  await browser.close();
  const failed = results.filter(r => !r[0]);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed at ${W}px`);
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(1); });
