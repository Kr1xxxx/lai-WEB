# 来财Lai — instructions for agents and developers

Read this first. Claude reads it through `CLAUDE.md`; Codex reads it directly.
Details live in `docs/`; this file only holds what you need every time.

## Project

来财Lai is a local CRM for a small export business (customers, contacts, follow-ups, segments, orders,
opportunities, team data, Zoho mail). Reference product: OKKI CRM (小满). **macOS only**, data stays on the Mac:
no server, no accounts yet. The UI is entirely in Chinese.

Stack: Swift AppKit shell + WKWebView (`native/`) → local Node HTTP server on 127.0.0.1 (`backend/`, Node 24+,
`node:sqlite`) → SQLite. The page is one HTML file assembled from `src/*.js|css` by `scripts/build.py`
(`assemble_html()`, markers in `src/template.html`). No npm dependencies; third-party code is vendored in `vendor/`.

## Before you start (every session)

1. Read `docs/HANDOFF.md` (status, task board) and `git log --oneline -20`.
2. Read `docs/DECISIONS.md`; make sure the task does not contradict a decision.
3. Run `npm run test:model` and `npm run test:e2e` so you know the starting point is green. If it is not, fix
   that first or record it in the handoff.
4. Branch from the latest `main` (`git fetch origin main:refs/remotes/origin/main`, then
   `git checkout -b claude/<short-name> origin/main`). Mark your task "In progress" on the task board.
   One task, one branch, one PR.

## Commands

```bash
npm run test:model       # unit/model/backend tests (tests/*.test.cjs, node:test)
npm run test:e2e         # browser end-to-end tests (tests/e2e/, real backend + real page, Playwright)
python3 -m unittest discover -s tests -p 'test_release_tools.py'   # build/export tool tests
python3 scripts/build.py --node-runtime "$(command -v node)"        # macOS only → dist/来财Lai.app
node scripts/integration-test.mjs                                   # macOS only, after the build
```

Playwright is **not** in `package.json` (the repo has no npm dependencies). Install it outside the tracked files:
`npm install --no-save --no-package-lock playwright@1.56.0 && npx playwright install chromium`. Set `CHROMIUM` to
use an existing Chromium binary. CI also builds the Mac app and runs the integration test (when: D-016).

## Structure

| Path | What it is |
| --- | --- |
| `src/app.js` | Routing, customer list/detail/segments, save coordination; ~4500 lines, search before editing |
| `src/*-model.js`, `model.js`, `segments.js`, `modules.js` | Pure logic; put new logic here, with unit tests |
| `src/*-ui.js`, `*-page.js`, `workbench.js`, `settings-hub.js` | Markup for each page; controllers live in `app.js` / `business-ui.js` |
| `src/rail-menu.js` | The one list of real left-rail entries (flyouts, sub-nav and 常用 all read it) |
| `src/template.html` + `scripts/build.py` | Page assembly: a new `src/` file needs a marker in both |
| `backend/server.js`, `storage.js` | Local routes and auth; SQLite with revisions (`baseRevision` rejects stale saves) |
| `backend/mail-*.js` | Zoho mail over IMAP/SMTP (vendored imapflow, nodemailer, postal-mime) |
| `native/` | Swift app shell, single instance, windows; Swift tests run inside `scripts/build.py` |
| `scripts/web-trial/` | Rebuild and check the published web trial page (README there) |
| `scripts/*-acceptance.*` | Older isolated acceptance scripts; most need the built Mac app |
| `tests/*.test.cjs` | node:test; some assert on source text and break on refactors |
| `tests/e2e/` | Browser end-to-end tests; `harness.mjs` starts the backend in a `lai-test-*` temp dir |
| `ARCHITECTURE.md`, `VALIDATION.md` | Code map and every business-rule decision made while building (Chinese, kept current) |
| `docs/features.json` | Feature verification list (verified in browser / on the Mac app) |
| `docs/samples/` | Mock data — the only data to test with |
| `docs/xiaoman/` | The owner's read-only record of OKKI (小满) settings, and how 来财 compares; reference only, not a to-do list |
| `docs/archive/` | Old plans and progress notes. **Out of date — do not follow them.** |

## Web trial

One published web trial page (a claude.ai Artifact) is shared by every session; the last publish wins. After a
change to the app is merged, publish it (D-012): read the live page first, rebuild with
`scripts/web-trial/rebuild.py`, test it yourself in a browser, and say which commit it was built from. The page
runs on browser storage, cannot reach real mail and cannot download files.

## Boundaries

**Always**
- Pass `npm run test:model` before committing; after UI changes also run `npm run test:e2e` and look at the page
  yourself (screenshots at 1440×900).
- After UI changes, run `scripts/ui-audit/ui-audit.cjs` against the rebuilt web trial (usage in its README) and keep the problem count at or below `scripts/ui-audit/baseline.json`; also walk through `UI_CHECKLIST.md`.
- Add tests with every feature; put user-visible flows in `tests/e2e/`.
- Write user-visible text in short, plain Chinese without technical terms. Developer docs are in English.
- Record each business-rule choice you make in `VALIDATION.md` (D-003); the owner can change it later.
- In `docs/features.json`, set `browser` or `mac` to `true` only after you actually walked through the steps.

**Ask the owner first**
- Changing or reversing anything in `docs/DECISIONS.md`.
- Adding a dependency or vendored library, changing the SQLite schema, revisions or the data directory — a mistake
  loses customer data, so it needs a migration and tests.
- Doing anything irreversible in the real world: sending mail from a real account, paying, changing or deleting
  the owner's real business data (D-004). Building those features does not need asking; running them does.
- Releasing a version (version number in `package.json`).

**Never**
- Push to `main`, or merge a PR labelled `needs-owner` before the owner says so (see "Merging").
- Commit real customer data, passwords, mail credentials, `.env`, databases or `dist/` — use `docs/samples/`.
- Delete or loosen a test just to make it pass — find out whether the code or the test is wrong, and say so in the PR.
- Install, replace or launch the owner's installed app, or write into `~/Library/Application Support/LaiCRM`
  (tests are blocked from it by `scripts/test-data-guard.cjs`).
- Enable the formal import entry before preview, commit, rollback and logging are complete (D-005).
- Recommend or build 回款 (payment collection) or 海关数据 (customs data) — the owner ruled them out (D-006).
- Leave entries that only say "功能入口已保留" — build the real feature or remove the entry (D-003).

## When you finish

1. Update `docs/HANDOFF.md` (status, task board) and add an entry at the top of `docs/handoff-log.md`.
2. Record new decisions in `docs/DECISIONS.md`; update `docs/features.json` for what you verified.
3. Merge the latest `main` into your branch, rerun the tests, commit in small steps, push, open a PR with the
   template. Label it `major` right away if it adds or removes a feature or changes a layout.
4. After merging, publish the web trial (D-012).
5. Report to the owner **in Chinese**, in four parts: 做了什么 / 没做好的地方 / 需要你做的 / 建议下一步. Say which
   PRs merged by themselves and which wait for him. Finish everything that can be finished instead of leaving it
   as a caveat; ask only what he must decide, all at once.

## Merging (D-014)

The owner does not use the GitHub website; all work goes through agents on his account. CI decides how each PR
merges (`scripts/classify-pr.mjs`, run by `merge-policy.yml` from `main`'s copy after CI passes; branches are
kept):

- **Small** — merges by itself once every check is green: wording, styling, bug fixes, tests and docs, with at most
  500 changed lines in `src/` (tests and docs do not count).
- **Big** — CI labels it `needs-owner` and stops: anything under `native/`, `backend/`, `vendor/`, `assets/`,
  `package.json`, CI and scripts (except browser checks and acceptance scripts), `.gitignore`, the rulebook
  (`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/DECISIONS.md`), data storage code in `src/`, deleted `src/`
  files, weakened tests, more than 500 lines of `src/`.
- New or removed features and layout changes cannot be detected from files: **add the `major` label yourself**
  (`gh pr edit <n> --add-label major`, or the REST labels API) right after opening the PR, before CI finishes.
- A `needs-owner` PR merges only after the owner writes 合并 in the conversation about that PR. Then:
  `gh api -X PUT repos/Kr1xxxx/lai-app/pulls/<n>/merge -f merge_method=merge`, and log it. Merge commits only, no
  squash.
- `git fetch origin <branch>` sometimes leaves the remote ref stale; use
  `git fetch origin <branch>:refs/remotes/origin/<branch>`.

Keep this file under 150 lines. Add a rule only after an agent repeats the same mistake; delete stale rules.
