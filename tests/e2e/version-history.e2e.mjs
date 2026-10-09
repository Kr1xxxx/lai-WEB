// Browser end-to-end test: clicking the version number in the top bar opens the version history, and it closes again.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
before(async () => { app = await startApp(); });
after(async () => { await app?.close(); });

test('the top bar shows 来财 without Lai, and the version number opens the version history', async () => {
  const { page } = app;
  await app.open('customers');
  const version = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  const brand = page.locator('.topbar .brand');
  assert.equal((await brand.locator('.brand-cn').textContent()).trim(), '来财');
  assert.doesNotMatch(await brand.innerText(), /Lai/);

  const button = page.locator('.topbar button.app-version');
  assert.equal((await button.innerText()).trim(), `v${version}`);
  await button.click();
  const dialog = page.locator('#overlay-root .drawer');
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /版本更新历史/);
  assert.match(await dialog.locator('.changelog-release').first().innerText(), new RegExp(`v${version.replace(/\./g, '\\.')}[\\s\\S]*当前版本`));
  assert.ok((await dialog.locator('.changelog-release li').count()) > 3, 'the release lists what changed');

  await dialog.getByRole('button', { name: '知道了' }).click();
  await page.locator('#overlay-root .drawer').waitFor({ state: 'detached' });
});
