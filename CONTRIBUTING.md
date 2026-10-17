# Contributing

For company developers and AI agents. Read `AGENTS.md` first.

## Starting a task

1. `git fetch origin main:refs/remotes/origin/main`, then branch from it: `git checkout -b claude/<short-name>
   origin/main` (people may use `feature/…` or `fix/…`).
2. Read `docs/HANDOFF.md` and `docs/DECISIONS.md`; make sure the task does not contradict a decision.
3. Run `npm run test:model` and `npm run test:e2e` to confirm the starting point is green. Playwright is installed
   outside `package.json`: `npm install --no-save --no-package-lock playwright@1.56.0 && npx playwright install chromium`.
4. Mark the task "In progress" on the board in `docs/HANDOFF.md`. One branch and one PR per task.

## Commits

- One logical change per commit, with a message that says what changed.
- Before committing: `npm run test:model` passes; after UI changes `npm run test:e2e` passes too.
- Never commit real customer data, passwords, mail credentials, `.env`, databases, `dist/` or `evidence/`.
  `.gitignore` keeps `docs/` ignored except the handoff files, so local screenshots there stay local.

## Pull requests

- Target `main` and fill in the template: what changed, how it was verified, what was not verified, what the
  owner needs to decide.
- CI (`.github/workflows/ci.yml`) runs: `tests` (model and tool tests), `browser end-to-end`, and on PRs `handoff updated` (fails if the app changed
  without `docs/HANDOFF.md`). All must be green.
- When CI passes, `.github/workflows/merge-policy.yml` runs `scripts/classify-pr.mjs` — always `main`'s copies, so a
  PR cannot change the rules that judge it — and posts the `merge policy` status: small PRs merge themselves (the
  branch is kept); big ones get the `needs-owner` label and wait. Label new/removed features and layout changes `major` yourself.
- A `needs-owner` PR is merged only after the owner says 合并 in the conversation. Never push to `main`.

## Finishing a task

- Update `docs/HANDOFF.md` (status, task board) and add an entry at the top of `docs/handoff-log.md`.
- For features you actually verified, set `browser` to `true` in `docs/features.json`.
- Record business-rule choices in `VALIDATION.md` and new owner decisions in `docs/DECISIONS.md`.
- After the merge, republish the web trial (`scripts/web-trial/README.md`).
- Report to the owner in Chinese, in four parts: 做了什么 / 没做好的地方 / 需要你做的 / 建议下一步.

## Repository settings

- Everyone, agents included, works through the owner's GitHub account; the owner does not use the website.
- The repository is private on a free plan, so GitHub branch protection, rulesets and native auto-merge are not
  available, and a single shared account cannot approve its own PRs. The merge policy therefore runs inside CI,
  and "never push to `main`" is a rule, not something GitHub enforces.
- With GitHub Pro (or a public repository) add a ruleset for `main`: require a pull request (0 approvals), require
  the status checks `tests`, `browser end-to-end`, `handoff updated`, `merge policy`,
  block force pushes and deletions.
- Labels used by CI: `needs-owner`, `auto-merged`, `major`.
