// CI guard: a pull request that changes the app must also update docs/HANDOFF.md,
// so the next developer or agent can pick up where this one stopped.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const APP_PATHS = /^(src|backend|native|vendor)\/|^package\.json$|^scripts\/build\.py$/;

export function checkHandoff(changed) {
  const touchesApp = changed.some((file) => APP_PATHS.test(file));
  return { touchesApp, ok: !touchesApp || changed.includes('docs/HANDOFF.md') };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const base = process.env.BASE_REF || 'origin/main';
  const changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
    .split('\n').map((line) => line.trim()).filter(Boolean);
  const { touchesApp, ok } = checkHandoff(changed);
  if (!ok) {
    console.error('This PR changes the app (src/, backend/, native/, vendor/, package.json or scripts/build.py) but not docs/HANDOFF.md.');
    console.error('Update the status and task board in docs/HANDOFF.md and add an entry to docs/handoff-log.md.');
    process.exit(1);
  }
  console.log(touchesApp ? 'docs/HANDOFF.md updated.' : 'No app changes; handoff check skipped.');
}
