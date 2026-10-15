// Decides when CI builds the Mac app (docs/DECISIONS.md D-016).
//   PAUSED (D-019, 2026-10-10): desktop builds are paused, only the web trial is built for now. While PAUSED is true
//   nothing builds the Mac app automatically; a manual run (workflow_dispatch) still works if the owner asks.
//   To resume, set PAUSED to false; the rules below apply again.
//   Claude PRs (branch claude/*): no Mac build on the PR, unless it changes native/ or scripts/build.py
//     (Swift only compiles on a Mac). Instead main gets a Mac build after every 10th merged Claude PR.
//   Everyone else (Codex, people): Mac build on every PR that changes more than docs and tests.
//   Manual runs (workflow_dispatch) always build.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PAUSED = true;
export const EVERY = 10;
const CLAUDE_MERGE = /^Merge pull request #\d+ from Kr1xxxx\/claude\//;
const DOCS_AND_TESTS = /^docs\/|\.md$|^tests\/[^/]+\.test\.cjs$|^tests\/e2e\/|^\.github\/pull_request_template\.md$/;
const NEEDS_MAC = /^native\/|^scripts\/build\.py$/;

/** Number of Claude PRs merged into main, from first-parent merge subjects. */
export const claudeMerges = (subjects) => subjects.filter((s) => CLAUDE_MERGE.test(s)).length;

/** @param {{ event: string, headRef?: string, files?: string[], headSubject?: string, mergedCount?: number, paused?: boolean }} input */
export function needsMac({ event, headRef = '', files = [], headSubject = '', mergedCount = 0, paused = PAUSED }) {
  if (event === 'workflow_dispatch') return true;
  if (paused) return false;
  if (event === 'push') return CLAUDE_MERGE.test(headSubject) && mergedCount > 0 && mergedCount % EVERY === 0;
  if (headRef.startsWith('claude/')) return files.some((f) => NEEDS_MAC.test(f));
  return files.some((f) => !DOCS_AND_TESTS.test(f));
}

/** After an automatic merge: should CI start a Mac build on main? */
export const dueAfterMerge = (mergedCount, paused = PAUSED) => !paused && mergedCount > 0 && mergedCount % EVERY === 0;

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);
const mergedOn = (ref) => claudeMerges(git(['log', '--first-parent', '--merges', '--format=%s', ref]));

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const mode = process.argv[2];
  let out;
  if (mode === 'after-merge') {
    const count = mergedOn(process.env.MAIN_REF || 'origin/main');
    out = `due=${dueAfterMerge(count)}`;
    console.log(`Claude PRs merged into main: ${count}; Mac build due: ${dueAfterMerge(count)}${PAUSED ? ' (desktop builds paused, D-019)' : ''}`);
  } else {
    const event = process.env.EVENT || 'pull_request';
    const base = process.env.BASE_REF;
    const input = { event, headRef: process.env.HEAD_REF || '' };
    if (event === 'pull_request') input.files = git(['diff', '--name-only', `${base}...HEAD`]);
    if (event === 'push') { input.headSubject = git(['log', '-1', '--format=%s', 'HEAD'])[0] || ''; input.mergedCount = mergedOn('HEAD'); }
    out = `mac=${needsMac(input)}`;
    console.log(JSON.stringify({ ...input, files: input.files?.length }), out);
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out + '\n');
}
