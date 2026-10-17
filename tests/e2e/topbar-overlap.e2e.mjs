// Browser end-to-end test: the top bar never overlaps itself. The global search box is centred by a formula and,
// in narrower windows, used to slide left over the logo and the version badge (seen at about 1200px wide).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
before(async () => { app = await startApp(); await app.open('customers'); });
after(async () => { await app?.close(); });

const WIDTHS = [1024, 1100, 1150, 1200, 1240, 1280, 1366, 1440, 1680];

test('the search box, the version badge and the right-hand actions never overlap', async () => {
  const { page } = app;
  for (const theme of ['pink', 'orange', 'xiaoman']) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 860 });
      const box = await page.evaluate((t) => {
        const html = document.documentElement;
        html.dataset.theme = t;
        html.dataset.skin = t === 'xiaoman' ? 'classic' : 'glass';
        const r = (selector) => document.querySelector(selector)?.getBoundingClientRect();
        return { version: r('.app-version'), search: r('.global-search'), actions: r('.top-actions') };
      }, theme);
      assert.ok(box.version && box.search && box.actions, `top bar parts exist (${theme} ${width})`);
      assert.ok(box.search.left >= box.version.right + 8,
        `search starts after the version badge (${theme} ${width}: ${Math.round(box.search.left)} vs ${Math.round(box.version.right)})`);
      assert.ok(box.search.right <= box.actions.left - 8,
        `search ends before the right-hand actions (${theme} ${width}: ${Math.round(box.search.right)} vs ${Math.round(box.actions.left)})`);
    }
  }
  assert.deepEqual(app.errors, []);
});
