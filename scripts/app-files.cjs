'use strict';
// The files the local server needs next to server.js. One list, shared by `npm start` (scripts/start.cjs)
// and the browser tests (tests/e2e/harness.mjs), so the two cannot drift apart.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

/** [source path in the repo, file name under <app>/vendor/] */
const VENDOR_FILES = [
  ['vendor/sheetjs-0.20.3/xlsx.full.min.js', 'xlsx.full.min.js'],
  ['vendor/mail-libs/mail-libs.cjs', 'mail-libs.cjs'],
  ['vendor/squire/squire-raw.js', 'squire-raw.js'],
  ['vendor/dompurify/purify.min.js', 'purify.min.js'],
];

/** Every backend/*.js file name; they are copied flat next to the page. */
function backendFiles(repoRoot = root) {
  return fs.readdirSync(path.join(repoRoot, 'backend')).filter((name) => name.endsWith('.js')).sort();
}

/** The single page, assembled by scripts/build.py (assemble_html), the same as the web trial build. */
function assembleHtml(repoRoot = root) {
  return execFileSync('python3', ['-c', 'import sys; sys.path.insert(0, "scripts"); import build; sys.stdout.write(build.assemble_html())'],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

module.exports = { root, VENDOR_FILES, backendFiles, assembleHtml };
