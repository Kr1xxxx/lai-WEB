// Source-text helpers for tests.
// scripts/build.py may join several src/ files into one <script> (its marker tuples use 'a.js|b.js|...').
// A test that checks the source text of such a script must read the whole joined script, never one part,
// so that moving code between the parts does not break it. These helpers read build.py to find the parts
// and join them exactly as build.py does ('\n'.join(read_text() for part in filename.split('|'))).
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');

// The src-relative parts of the marker entry whose filename field is `name` or starts with `name|`.
function scriptParts(name) {
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build.py'), 'utf8');
  const matches = [];
  for (const m of build.matchAll(/\('<!--[A-Z0-9_]+-->'\s*,\s*'([^']+)'\s*,\s*'(?:script|style)'\)/g)) {
    const field = m[1];
    if (field === name || field.startsWith(name + '|')) matches.push(field);
  }
  if (matches.length !== 1) {
    throw new Error(`scripts/build.py: expected exactly one marker entry for "${name}", found ${matches.length}`);
  }
  return matches[0].split('|');
}

// The parts read and joined with '\n', exactly as build.py puts them into the page.
function scriptSource(name) {
  return scriptParts(name).map(part => fs.readFileSync(path.resolve(SRC, part), 'utf8')).join('\n');
}

function appSource() {
  return scriptSource('app.js');
}

module.exports = { scriptParts, scriptSource, appSource };
