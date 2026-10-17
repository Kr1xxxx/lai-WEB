'use strict';
// tests/helpers/source.cjs reads the app script the way scripts/build.py joins it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scriptParts, scriptSource, appSource } = require('./helpers/source.cjs');

test('app.js is the first part of the app script', () => {
  assert.equal(scriptParts('app.js')[0], 'app.js');
});

test('appSource() is the whole IIFE, boot call included', () => {
  const app = appSource();
  assert.ok(app.startsWith('(() => {'));
  assert.ok(app.includes('\n  boot();\n'));
});

test('a single-file entry reads as that file', () => {
  assert.deepEqual(scriptParts('workbench.js'), ['workbench.js']);
  assert.equal(scriptSource('workbench.js'), fs.readFileSync(path.join(__dirname, '../src/workbench.js'), 'utf8'));
});

test('a multi-part entry joins its parts with a newline', () => {
  const parts = scriptParts('../vendor/flatpickr/flatpickr.min.js');
  assert.equal(parts.at(-1), 'date-picker.js');
  const joined = parts.map(p => fs.readFileSync(path.resolve(__dirname, '../src', p), 'utf8')).join('\n');
  assert.equal(scriptSource('../vendor/flatpickr/flatpickr.min.js'), joined);
});

test('an unknown name throws', () => {
  assert.throws(() => scriptParts('no-such-file.js'), /expected exactly one marker entry/);
  assert.throws(() => scriptSource('no-such-file.js'), /no-such-file\.js/);
});
