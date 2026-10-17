// The page frame (topbar, rail, sub-navigation) is drawn once; pages render into <main> through renderShell.
// These checks read src/app.js so that a new page cannot quietly go back to replacing the whole #app.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { appSource } = require('./helpers/source.cjs');

const app = appSource();
const body = (name) => {
  const start = app.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  return app.slice(start, app.indexOf('\n  }\n', start));
};

test('only renderShell writes the frame; every page goes through it', () => {
  const code = body('renderShell');
  const writes = [...app.matchAll(/innerHTML = shell\(/g)];
  assert.equal(writes.length, 2, 'two places use the frame markup, both inside renderShell');
  const start = app.indexOf('  function renderShell(');
  for (const write of writes) assert.ok(write.index > start && write.index < start + code.length, 'inside renderShell');
  assert.ok(code.includes('app.innerHTML = shell(content)'), 'the whole frame is drawn only by renderShell (first draw)');
  assert.ok(code.includes('template.innerHTML = shell("")'), 'later draws parse the frame markup and update the live frame in place');
  assert.doesNotMatch(app, /\$\("#app"\)\.innerHTML = shell\(/);
  assert.ok([...app.matchAll(/renderShell\(/g)].length >= 10, 'the customer pages, blocked pages, 常用 and the business, mail and chat mounts use it');
  for (const mount of app.matchAll(/mount: \(html\) => \{[\s\S]*?\n {4}\}/g)) assert.match(mount[0], /renderShell\(html\)/);
});

test('renderShell redraws the whole frame only on first draw, a theme change or an account switch', () => {
  const code = body('renderShell');
  assert.match(code, /const key = `\$\{document\.documentElement\.dataset\.theme \|\| ""\}\|\$\{R\.currentMember\(state\)\?\.id \|\| ""\}`/);
  assert.match(code, /if \(!liveMain \|\| key !== shellKey\)/);
  // Otherwise the frame elements are updated in place and only <main>'s content and class change.
  assert.match(code, /morphNode\(live\.get\(part\), next\)/);
  assert.match(code, /node\.innerHTML = content;/);
  assert.match(code, /node\.setAttribute\("class", next\.getAttribute\("class"\)\)/);
  // Leftovers such as the rail hover menu go away, as they did when the whole frame was redrawn.
  assert.match(code, /else child\.remove\(\);/);
});

test('focus goes back only to a form control in the same view, and never steals focus that moved elsewhere', () => {
  const code = body('renderShell');
  assert.match(code, /const locator = view === shellView \? focusLocator\(liveMain\) : null;/);
  const restore = body('restoreFocus');
  assert.match(restore, /queueMicrotask/);
  assert.match(restore, /if \(document\.activeElement && document\.activeElement !== document\.body\) return;/);
  const locate = body('focusLocator');
  assert.match(locate, /\["INPUT", "SELECT", "TEXTAREA"\]\.includes\(el\.tagName\)/);
  assert.match(locate, /lai-select-trigger/);
});
