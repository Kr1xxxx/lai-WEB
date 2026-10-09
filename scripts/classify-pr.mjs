// Decides whether a pull request may merge on its own ("small") or must wait for the owner ("big").
// Policy: docs/DECISIONS.md D-014. CI calls this; the pure `classify` function is unit-tested
// (tests/classify-pr.test.cjs).
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Measured on main (2026-10-08): merged fixes changed 5–93 lines of src/, merged features 460+.
export const UI_LINE_LIMIT = 350;

// Changes to how the product or the process works — always the owner's call.
//   native/  : the Mac app shell          backend/ : local server, data storage, mail
//   vendor/  : third-party code            assets/  : app icon
//   scripts/ : build and CI tools (browser checks and acceptance scripts count as tests, see TEST_PATHS)
const OWNER_PATHS = [
  /^native\//, /^backend\//, /^vendor\//, /^assets\//,
  /^package(-lock)?\.json$/, /^source-manifest\.json$/, /^\.github\//, /^\.gitignore$/, /^scripts\//,
  /^AGENTS\.md$/, /^CLAUDE\.md$/, /^CONTRIBUTING\.md$/, /^docs\/DECISIONS\.md$/,
];
const TEST_PATHS = [/^tests\//, /^scripts\/[^/]*-acceptance\.[a-z]+$/, /^scripts\/web-trial\/[^/]*-check\.cjs$/];
const isTest = (path) => TEST_PATHS.some((pattern) => pattern.test(path));

// Data storage inside the page: a mistake here can lose or overwrite customer data.
const STORAGE_WORDS = /localStorage|sessionStorage|indexedDB|baseRevision|\/api\/save|\/api\/data|node:sqlite|DatabaseSync/;

/**
 * @param {{ files: { path: string, added: number, deleted: number, status: string }[],
 *           uiDiff: string, labels: string[] }} change
 */
export function classify({ files, uiDiff, labels }) {
  const reasons = [];
  if (labels.includes('major')) reasons.push('labelled major (new feature, removed feature or layout change)');
  for (const file of files) {
    if (!isTest(file.path) && OWNER_PATHS.some((pattern) => pattern.test(file.path))) reasons.push(`changes ${file.path}`);
    if (file.status === 'D' && (/^src\//.test(file.path) || isTest(file.path))) reasons.push(`deletes ${file.path}`);
  }
  const changedLines = uiDiff.split('\n').filter((line) => /^[+-](?![+-])/.test(line));
  if (changedLines.some((line) => STORAGE_WORDS.test(line))) reasons.push('touches data storage');
  const uiLines = files.filter((file) => file.path.startsWith('src/')).reduce((sum, file) => sum + file.added + file.deleted, 0);
  if (uiLines > UI_LINE_LIMIT) reasons.push(`${uiLines} lines of src/ changed (limit ${UI_LINE_LIMIT})`);
  const testNet = files.filter((file) => isTest(file.path)).reduce((sum, file) => sum + file.added - file.deleted, 0);
  if (testNet < -10) reasons.push(`removes ${-testNet} more test lines than it adds`);
  return { size: reasons.length ? 'big' : 'small', reasons: [...new Set(reasons)] };
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function collect(base) {
  const statuses = new Map(git(['diff', '--name-status', `${base}...HEAD`]).split('\n').filter(Boolean).map((line) => {
    const [status, ...paths] = line.split('\t');
    return [paths.at(-1), status[0]];
  }));
  const files = git(['diff', '--numstat', `${base}...HEAD`]).split('\n').filter(Boolean).map((line) => {
    const [added, deleted, ...rest] = line.split('\t');
    const path = rest.join('\t').replace(/^.*\{.* => (.*)\}(.*)$/, (_, to, tail) => to + tail).replace(/^.* => /, '');
    return { path, added: Number(added) || 0, deleted: Number(deleted) || 0, status: statuses.get(path) || 'M' };
  });
  return { files, uiDiff: git(['diff', '--unified=0', `${base}...HEAD`, '--', 'src']) };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const labels = JSON.parse(process.env.LABELS || '[]');
  const result = classify({ ...collect(process.env.BASE_REF || 'origin/main'), labels });
  console.log(`size: ${result.size}`);
  for (const reason of result.reasons) console.log(`- ${reason}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `size=${result.size}\n`);
}
