// Browser end-to-end test: the page draws Chinese with MiSans and Latin text with Inter, both embedded in the page.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
before(async () => { app = await startApp(); });
after(async () => { await app?.close(); });

test('the customer list loads MiSans and Inter from the page itself, and 关于来财Lai names them', async () => {
  const { page } = app;
  await app.open('customers');
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, ''));
    return { loaded: [...new Set(loaded)], body: getComputedStyle(document.body).fontFamily };
  });
  assert.ok(fonts.loaded.includes('MiSans VF'), `loaded: ${fonts.loaded}`);
  assert.ok(fonts.loaded.includes('Inter'), `loaded: ${fonts.loaded}`);
  assert.match(fonts.body, /^"?Inter"?, "?MiSans VF"?/);

  await page.locator('.top-actions button[data-action="about"]').click();
  const dialog = page.locator('#overlay-root .drawer');
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /中文使用小米 MiSans 字体，英文和数字使用 Inter 字体/);
});
