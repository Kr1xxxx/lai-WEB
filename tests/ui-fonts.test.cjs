// The interface uses one font stack: Inter for Latin letters and digits, MiSans for Chinese (vendor/fonts).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { appSource } = require('./helpers/source.cjs');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('every font file named in vendor/fonts/fonts.css exists, and every MiSans slice is used', () => {
  const css = read('vendor/fonts/fonts.css');
  const urls = [...css.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
  for (const url of urls) assert.ok(fs.existsSync(path.join(root, 'vendor/fonts', url)), url);
  const slices = fs.readdirSync(path.join(root, 'vendor/fonts/misans')).filter((f) => f.endsWith('.woff2'));
  assert.equal(slices.length, 55); // 56 official slices; one held only rare hanzi and was dropped by the subset (vendor/fonts/SUBSET.md)
  for (const slice of slices) assert.ok(urls.includes('misans/' + slice), slice);
  assert.ok(urls.includes('inter/inter-latin-wght-normal.woff2'));
  // Chinese quotes, dash and ellipsis stay with MiSans.
  for (const face of css.match(/@font-face\{font-family:"Inter"[^}]*\}/g)) assert.doesNotMatch(face, /U\+2000-206F|U\+201C|U\+2026/);
  for (const license of ['inter/LICENSE', 'misans/MiSans-License.txt', 'misans/PACKAGING-LICENSE-Apache-2.0', 'README.md', 'SUBSET.md']) assert.ok(fs.existsSync(path.join(root, 'vendor/fonts', license)), license);
});

test('the font token starts with Inter then MiSans, and styles use the token instead of their own stacks', () => {
  assert.match(read('src/ui-tokens.css'), /--font-ui:\s*"Inter", "MiSans VF",/);
  for (const file of fs.readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.css'))) {
    for (const [, value] of read('src/' + file).matchAll(/font-family:\s*([^;]+);/g)) {
      if (/Yuanti SC/.test(value)) continue; // the rounded 来财 wordmark in the top bar keeps its own font
      assert.match(value.trim(), /^(var\(--font-ui\)|inherit)$/, `${file}: ${value.trim()}`);
    }
  }
});

test('the assembled page embeds the fonts and credits MiSans in 关于来财Lai', () => {
  const html = execFileSync('python3', ['-c', 'import sys; sys.path.insert(0, "scripts"); import build; sys.stdout.write(build.assemble_html())'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const head = html.slice(0, html.indexOf('</head>'));
  assert.equal((head.match(/font-family:"MiSans VF"/g) || []).length, 55);
  assert.equal((head.match(/font-family:"Inter"/g) || []).length, 2);
  assert.doesNotMatch(head, /url\('(?!data:font\/woff2;base64,)/);
  assert.ok(head.indexOf('font-family:"Inter"') < head.indexOf('--font-ui'), 'fonts come before the tokens');
  assert.match(appSource(), /中文使用小米 MiSans 字体，英文和数字使用 Inter 字体/);
});
