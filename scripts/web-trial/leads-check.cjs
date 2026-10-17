// Browser walk-through of the 线索 (leads) module on a rebuilt web trial page.
//   node scripts/web-trial/serve.cjs /path/to/lai-web.html &
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core SHOTS=/path/to/shots/ node scripts/web-trial/leads-check.cjs [width]
// Starts from empty browser storage, so it never touches saved trial data of a real profile.
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const SHOTS = process.env.SHOTS || require('os').tmpdir() + '/';
const URL = process.env.TRIAL_URL || 'http://127.0.0.1:8766/';
const W = Number(process.argv[2] || 1440);
const results = [];
const note = (ok, msg) => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: W, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  const shot = name => page.screenshot({ path: `${SHOTS}leads-${W}-${name}.png` });
  const settle = () => page.waitForTimeout(350);
  const text = sel => page.locator(sel).first().innerText();
  const count = sel => page.locator(sel).count();
  const tab = id => page.locator(`[data-lead-status="${id}"] b`).innerText();
  const fill = async (form, values) => { for (const [name, value] of Object.entries(values)) await page.locator(`${form} [name="${name}"]`).fill(value); };
  const submit = async form => { await page.locator(`button[type="submit"][form="${form}"], #${form} button[type="submit"]`).first().click(); await settle(); };

  await page.goto(URL);
  await page.waitForSelector('.rail-item[data-rail-menu="线索"]');
  await page.locator('.rail-item[data-rail-menu="线索"]').click();
  await settle();
  note((await text('.lead-none .k-empty-title')) === '还没有线索', '1 empty state explains what a lead is');
  note(!(await page.content()).includes('功能入口已保留，深入功能待后续实现') || (await count('.lead-page')) === 1, '1 the page is the real module, not the reserved-entry notice');
  await shot('01-empty');

  // new lead
  await page.locator('.lead-none [data-lead-action="new"]').click();
  await settle();
  await fill('#lead-form', { name: 'Northwind Beauty GmbH', contact: 'Anna Berg', email: 'anna@northwind.example', phone: '+49 30 1234567', source: '展会', owner: 'Amy', product: '磁吸假睫毛', note: '展会上留的名片，想要小批量试单。' });
  await shot('02-new-form');
  await submit('lead-form');
  note((await count('.lead-table tbody tr')) === 1 && (await tab('new')) === '1', '2 new lead appears in the list as 新线索');

  // validation: empty name is refused by the form, bad email by the model
  await page.locator('[data-lead-action="new"]').first().click();
  await settle();
  await fill('#lead-form', { name: 'Bad Mail Co', email: 'a@b' });
  await page.locator('#lead-form').evaluate(form => { form.noValidate = true; });
  await submit('lead-form');
  note((await text('#lead-error')).includes('邮箱格式不正确'), '2 a malformed email is refused with a message and the form stays open');
  await fill('#lead-form', { name: 'Aurora Lash Studio', email: 'hello@aurora.example', contact: 'Mei', nextFollow: '2020-01-02' });
  await page.locator('#lead-form').evaluate(form => { form.noValidate = false; });
  await submit('lead-form');
  note((await tab('all')) === '2', '2 second lead saved');
  note((await count('.lead-row-overdue')) === 1 && (await text('.lead-due-toggle b')) === '1', '2 a past follow-up date shows as overdue and is counted in 该跟进的');

  // follow-up from the row
  await page.locator('.lead-table tbody tr:has-text("Northwind") [data-lead-action="follow"]').click();
  await settle();
  note(await page.locator('#lead-follow-form textarea').evaluate(el => el === document.activeElement), '3 写跟进 opens the detail with the cursor in the follow-up box');
  await page.locator('#lead-follow-form textarea').fill('电话沟通：需要 500 盒报价，下周寄样品。');
  await page.locator('#lead-follow-form [name="nextFollow"]').fill('2099-12-31');
  await submit('lead-follow-form');
  note((await count('.lead-timeline .is-followup')) === 1 && (await text('.lead-detail-head .lead-status')) === '跟进中', '3 follow-up is in the timeline and the lead is now 跟进中');
  await shot('03-detail-after-followup');
  await page.locator('[data-action="close-modal"]').first().click();
  await settle();
  note((await tab('following')) === '1' && (await tab('new')) === '1', '3 tab counts follow the status change');
  await shot('04-list');

  // filters
  await page.locator('[data-lead-status="following"]').click();
  await settle();
  note((await count('.lead-table tbody tr')) === 1, '4 status tab filters the list');
  await page.locator('[data-lead-status="all"]').click();
  await page.locator('#lead-search').fill('aurora');
  await page.locator('#lead-search').press('Enter');
  await settle();
  note((await count('.lead-table tbody tr')) === 1 && (await text('.lead-table tbody tr')).includes('Aurora'), '4 search narrows the list');
  await page.locator('#lead-search').fill('');
  await page.locator('#lead-search').press('Enter');
  await settle();

  // convert to a new customer: country and source are required
  await page.locator('.lead-table tbody tr:has-text("Northwind") [data-lead-action="convert"]').click();
  await settle();
  note((await page.locator('#lead-convert-form [name="name"]').inputValue()) === 'Northwind Beauty GmbH' && (await page.locator('#lead-convert-form [name="source"]').inputValue()) === '展会', '5 convert form is prefilled from the lead');
  await page.locator('#lead-convert-form').evaluate(form => { form.noValidate = true; });
  await submit('lead-convert-form');
  note((await text('#lead-convert-error')).includes('国家地区'), '5 converting without a country is refused');
  await page.locator('#lead-convert-form [name="country"]').fill('德国');
  await shot('05-convert-form');
  await submit('lead-convert-form');
  note((await text('.lead-detail-head .lead-status')) === '已转客户' && (await count('.lead-banner.is-converted [data-biz-customer]')) === 1, '5 lead is 已转客户 and links to the new customer');
  note((await count('#lead-follow-form')) === 0, '5 a converted lead no longer offers 写跟进');
  await shot('06-converted-detail');
  await page.locator('.lead-banner.is-converted [data-biz-customer]').click();
  await page.waitForTimeout(900);
  const customerPage = await page.content();
  note(customerPage.includes('Northwind Beauty GmbH') && customerPage.includes('anna@northwind.example'), '5 the link opens the new customer, with the contact details carried over');
  note(customerPage.includes('由线索转入'), '5 the customer history records where it came from');
  await shot('07-customer');

  // duplicate hint + link to an existing customer
  await page.locator('.rail-item[data-rail-menu="线索"]').click();
  await settle();
  await page.locator('[data-lead-action="new"]').first().click();
  await settle();
  await fill('#lead-form', { name: 'northwind beauty gmbh', contact: 'Jonas' });
  await submit('lead-form');
  note((await count('.lead-table .lead-dup')) >= 1, '6 a lead with the same name as a customer is flagged 可能重复');
  await page.locator('.lead-table tbody tr:has(.lead-dup) [data-lead-action="convert"]').first().click();
  await settle();
  note(await page.locator('#lead-convert-form [name="mode"][value="existing"]').isChecked() && (await page.locator('#lead-convert-form [name="existing"]').inputValue()) === 'Northwind Beauty GmbH', '6 the convert form defaults to linking the existing customer');
  await shot('08-convert-existing');
  await submit('lead-convert-form');
  note((await tab('converted')) === '2', '6 linked without creating a second customer record');

  // invalid, reopen
  await page.locator('[data-action="close-modal"]').first().click();
  await settle();
  await page.locator('.lead-table tbody tr:has-text("Aurora") [data-lead-action="open"]').click();
  await settle();
  await page.locator('.lead-detail-actions [data-lead-action="invalid"]').click();
  await settle();
  await page.locator('#lead-invalid-form [name="reason"]').selectOption('没有需求');
  await submit('lead-invalid-form');
  note((await text('.lead-banner.is-invalid')).includes('没有需求'), '7 marked invalid with the reason shown');
  await page.locator('.lead-detail-actions [data-lead-action="reopen"]').click();
  await settle();
  note((await text('.lead-detail-head .lead-status')) === '新线索', '7 重新跟进 puts a never-followed lead back to 新线索');

  // trash, restore, delete
  await page.locator('.lead-detail-actions [data-lead-action="trash"]').click();
  await settle();
  note((await tab('all')) === '2' && (await text('[data-lead-action="trash-page"]')).includes('1'), '8 trashed lead leaves the list and the 回收站 button counts it');
  await page.locator('[data-lead-action="trash-page"]').click();
  await settle();
  await shot('09-trash');
  await page.locator('[data-lead-action="delete"]').click();
  await settle();
  note((await text('[data-lead-action="delete"]')).includes('再点一次'), '8 delete asks for a second click');
  await page.locator('[data-lead-action="restore"]').click();
  await settle();
  note((await count('.lead-none')) === 1, '8 restore empties the trash');
  await page.locator('[data-lead-action="list-page"]').click();
  await settle();
  note((await tab('all')) === '3', '8 restored lead is back in the list');

  // persistence
  await page.reload();
  await page.waitForSelector('.rail-item[data-rail-menu="线索"]');
  await page.locator('.rail-item[data-rail-menu="线索"]').click();
  await settle();
  note((await tab('all')) === '3' && (await tab('converted')) === '2', '9 leads survive a reload');
  await shot('10-final-list');
  note(errors.length === 0, `9 page errors: ${errors.length}`);
  if (errors.length) console.log(errors.slice(0, 8).join('\n'));
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed at ${W}px`);
  await browser.close();
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(error => { console.error(error); process.exit(1); });
