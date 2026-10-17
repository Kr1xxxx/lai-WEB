// Kit classes guard (D-028): new markup uses the kit in src/ui-kit.css (.k-btn--primary, .k-pager, .k-empty, .k-table)
// instead of inventing another page-specific primary button, pager, empty state or table. The class names that exist
// today are listed in tests/fixtures/ui-kit-legacy-classes.json; a name that is not on that list fails this test.
// The list only shrinks: when a page moves to the kit, delete its names from the list (the test also fails on a listed
// name that no longer appears anywhere, so the list stays honest). To see what the scanner finds:
//   PRINT_UI_KIT_CLASSES=/tmp/found.json node --test tests/ui-kit-classes.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = path.join(__dirname, '..', 'src');
const listPath = path.join(__dirname, 'fixtures', 'ui-kit-legacy-classes.json');
const KINDS = ['primary', 'pages', 'empty'];
// mail-ui.js and mail-editor.js carry user mail HTML and vendored editor code; their class names are part of the
// mail module and are scanned too, but data-/aria- attributes and CSS custom properties are not class names.
const files = fs.readdirSync(src).filter((f) => /\.(js|css)$/.test(f)).sort();

function scan() {
  const found = { primary: new Set(), pages: new Set(), empty: new Set(), table: new Set() };
  for (const file of files) {
    let text = fs.readFileSync(path.join(src, file), 'utf8');
    if (file.endsWith('.css')) {
      text = text.replace(/\/\*[\s\S]*?\*\//g, '');
      // only selectors: the part before each declaration block
      for (const [, selector] of text.matchAll(/([^{}]*)\{[^{}]*\}/g)) {
        for (const [, name, kind] of selector.matchAll(/\.([a-z][a-z0-9]*(?:-[a-z0-9]+)*-(primary|pages|empty))(?![\w-])/g)) found[kind].add(name);
      }
    } else {
      for (const [, name, kind] of text.matchAll(/(?<![\w$.-])([a-z][a-z0-9]*(?:-[a-z0-9]+)*-(primary|pages|empty))(?![\w-])/g)) {
        if (/^(data|aria)-/.test(name)) continue;
        found[kind].add(name);
      }
      for (const [, cls] of text.matchAll(/<table class=\\?["']([^"'\\]*)/g)) found.table.add(cls.trim());
    }
  }
  for (const kind of Object.keys(found)) for (const name of [...found[kind]]) if (/^k-/.test(name)) found[kind].delete(name);
  return Object.fromEntries(Object.entries(found).map(([k, v]) => [k, [...v].sort()]));
}

test('no new page-specific primary buttons, pagers, empty states or table classes: use the kit (src/ui-kit.css)', () => {
  const now = scan();
  if (process.env.PRINT_UI_KIT_CLASSES) fs.writeFileSync(process.env.PRINT_UI_KIT_CLASSES, JSON.stringify(now, null, 1));
  const allowed = JSON.parse(fs.readFileSync(listPath, 'utf8'));
  for (const kind of [...KINDS, 'table']) {
    const extra = now[kind].filter((name) => !allowed[kind].includes(name));
    assert.deepEqual(extra, [], `new ${kind === 'table' ? '<table class=…>' : '*-' + kind} names; use the kit class instead (k-btn--primary, k-pager, k-empty, k-table)`);
    const gone = allowed[kind].filter((name) => !now[kind].includes(name));
    assert.deepEqual(gone, [], `these ${kind} names are gone: delete them from tests/fixtures/ui-kit-legacy-classes.json`);
  }
});

test('the kit itself provides the replacements', () => {
  const kit = fs.readFileSync(path.join(src, 'ui-kit.css'), 'utf8');
  for (const cls of ['.k-btn--primary', '.k-pager', '.k-empty', '.k-table', '.k-dialog', '.k-drawer', '.k-error', '.k-tabs', '.k-badge', '.k-card', '.k-input', '.k-select-trigger', '.k-textarea', '.k-toast', '.k-pageheader', '.k-tabs--vertical', '.k-switch', '.k-checkbox']) {
    assert.ok(kit.includes(cls), cls);
  }
});
