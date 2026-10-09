# Session log

Newest first. One entry per session: date — who (person or agent) — what was done, what is unfinished, next step.
When this file passes 200 lines, move older entries to `docs/handoff-log-archive.md`.
Entries before 2026-10-08 were reconstructed from `git log`; details are in `VALIDATION.md` and `docs/archive/`.

- 2026-10-09 — Claude — Owner asked for a new way of working (D-017): Opus 5.5 at high effort coordinates; subagents
  default to Sonnet 5.5 at medium effort (`CLAUDE_CODE_SUBAGENT_MODEL` in `.claude/settings.json`, `worker` and
  `reviewer` agents in `.claude/agents/`). Opus writes the spec, plan and every subagent prompt, picks each subagent's
  model/effort, runs slices in parallel worktrees (`worktree.baseRef: head`) and merges them itself. Checked in this
  session: a Sonnet worktree agent committed on `worktree-agent-<id>` and the coordinator merged it cleanly
  (throwaway, removed). The new settings load from the next session on. Touches `CLAUDE.md` → waits for 合并.
- 2026-10-09 — Claude — Owner said 合并 on PR #14 (客户设置 A1): merged (`main` 6941054); Mac build not due (14 Claude PRs
  merged, due at 20). The web trial was not republished yet (see `HANDOFF.md` status for how). Next: A2.
- 2026-10-09 — Claude — Owner attached three 小满 settings collection docs and chose batch "A 客户设置". Built the first half
  on `claude/customer-settings`: the 客户设置 page now has seven working tabs (客户分组 two levels with per-owner
  availability, 客户阶段, 客户类型 — a new customer field, 建档黑名单, 客户上限, 客户查重 display fields, 布局设置 for the
  detail page). They are wired into the customer editor, create / batch create / import / batch assign / pool claim, the
  duplicates page and the detail layout. Settings live in `laiSettings.customerSettings` (no schema change). The placeholder
  button 客户字段管理 was removed. Rules chosen are in `VALIDATION.md`. Labelled `major`; waits for 合并. Next: batch A2
  (公海管理, 客户跟进规则, 客户成交规则, 动态设置, 写跟进设置). Not yet verified on the Mac app.
- 2026-10-09 — Claude — Owner said 合并 on PR #12 (merge policy from `main`'s copy): merged (1308c75). PR #11 (test waits, handoff
  status, features.json) had merged itself. This log entry is a docs-only PR, the first one judged by the new
  `merge-policy.yml`, to check that it runs after CI and merges a small PR.
- 2026-10-09 — Claude — Merge policy hardened (owner asked to tidy the rules): the small/big decision moved out of
  `ci.yml` into `.github/workflows/merge-policy.yml`, which runs after CI via `workflow_run` and always uses
  `main`'s workflow and scripts, so a PR can no longer edit `classify-pr.mjs` to merge itself (simulated: the
  tampered copy says small, main's copy says big). It merges only the exact commit CI tested, keeps the branch
  (no more `--delete-branch`), and posts a `merge policy` status on the PR. Waits for 合并.
- 2026-10-09 — Claude — Owner asked to check and tidy the rule files. Server-start waits in three tests raised to 10 s (one
  failed once on a slow CI runner); `docs/HANDOFF.md` status brought up to date; four UI features added to
  `docs/features.json` (browser-verified, Mac not yet). CI fixes (classify with `main`'s script, keep branches) are a
  separate PR that waits for 合并.
- 2026-10-09 — Claude — Owner said 合并 (twice: PR #3, then the four UI branches). Merged PR #3 (small-PR limit 500, Mac build
  cadence; I merged `main` into its branch first because of docs conflicts), then PR #6 left rail, #7 truncation, #8
  dropdowns, #9 UI audit. `main` is now 91906aa. The web trial (Version 44) was built from the same code, so nothing
  was republished. Mac build is not due yet (9 Claude PRs merged). Next: task 2 (leads → attachments → 1.4.127).
- 2026-10-09 — Claude — UI audit (`claude/ui-audit-plan`): `UI_CHECKLIST.md` (what to look at after any UI change) and
  `scripts/ui-audit/` (finds covered elements, native selects, mixed dropdown styles and font/colour jumps on click;
  runs against the web trial; `baseline.json`). `AGENTS.md` now tells agents to run it after UI changes. The earlier
  phases (rail, dropdowns, truncation, date picker) are already merged. Owner said 合并.
- 2026-10-09 — Claude — Dropdowns (`claude/unify-dropdowns`, D-010): every `<select>` on the page is now the same custom dropdown
  (`LaiCustomerSelect.watch()` upgrades them as they appear; search box from 9 options; trigger as wide as the longest
  option; one set of size/colour tokens). 0 native selects left in the audit. Layout change, labelled `major`. Owner said
  合并. Not yet on the Mac app.
- 2026-10-09 — Claude — Truncated text (`claude/truncation`): order numbers are never cut off any more (the column is wide
  enough and has no ellipsis); any other text cut with … or a line clamp shows its full text on hover
  (`src/truncation-title.js`, new file, wired in `scripts/build.py` and `src/template.html`). Owner said 合并. Not yet on the Mac app.
- 2026-10-09 — Claude — Left rail (`claude/rail-layout`): the rail's scrolling entries and the refresh button are now separate, so
  they can no longer overlap; the 13 entries fit the window height. Layout change, so labelled `major`. Owner said 合并.
  Checked in a headless browser at 1440×900 and small heights; not yet on the Mac app.
- 2026-10-09 — Claude — PR #2 (docs only) merged itself: auto-merge works. Owner raised the small-PR limit to
  500 lines of `src/` (D-014) and set the Mac build to every 10th merged Claude PR, Claude only (D-016,
  `scripts/mac-cadence.mjs`, instruction in `CLAUDE.md`). Waits for 合并.
- 2026-10-09 — Claude — Owner said 合并 on PR #4 (date picker, Monday-first week): merged into `main` (3dca7b3), all checks
  green. Web trial republished as Version 44 from `main` plus the four still-unmerged UI branches (`claude/rail-layout`,
  `claude/unify-dropdowns`, `claude/truncation`, `claude/ui-audit-plan`); those four are not PRs yet (task 2).
- 2026-10-09 — Claude — Date and month fields (`claude/date-picker`): every `input[type=date|month]` now shows a
  Chinese flatpickr 4.6.13 calendar (vendored in `vendor/flatpickr/`, inlined by `scripts/build.py`) instead of the
  system control with `mm/dd/yyyy`; the native input stays hidden as the data carrier, so values, validation and events
  are unchanged. The owner asked for a mature ready-made component and approved this one in the conversation (D-011).
  Checked in a headless browser (order drawer, opportunity date range, calendar month); not yet on the Mac app.
  Owner then asked for Monday as the first day of the week (set in `date-picker.js`) and said 合并 on PR #4.
- 2026-10-09 — Claude — Owner said 合并: merged PR #1 (handoff rules, merge policy, e2e tests, CI) into `main`
  (545bcc8). This log entry is PR #2, a docs-only change, to check that small PRs merge by themselves.
- 2026-10-08 — Claude — Handoff rules from the owner's multi-agent standard (reference: Kr1xxxx/Clipbox):
  `AGENTS.md` (+ `CLAUDE.md` → `@AGENTS.md`), `CONTRIBUTING.md`, PR template, `docs/DECISIONS.md` (D-001…D-015
  from the owner's past decisions), this board, `docs/features.json`, `docs/samples/`, old `NEXT_STEPS.md` and
  `PROGRESS.md` moved to `docs/archive/`. Merge policy `scripts/classify-pr.mjs` (350-line limit checked against
  past merges: fixes 5–93 lines, features 460+), handoff check, 5 browser e2e tests with the real backend
  (`tests/e2e/`), one CI workflow (tests, e2e, Mac build + integration, handoff, merge policy); labels
  `needs-owner`, `auto-merged`, `major` created. Folds in `claude/macos-ci`. Unfinished: waiting branches not yet
  turned into PRs. Next: owner says 合并, then branch PRs one by one.
- 2026-10-08 — Claude (several sessions) — Merged into `main`: settings/企业管理 split, rail refresh button room,
  customer detail polish, trial demo mails, segment banner removed, dead entries removed (客服, AI批量质检),
  customer tools, UI consistency, light accents, redesigned pages, theme templates (小满 default, pink, orange).
- 2026-10-08 — Claude — First macOS CI on branch `claude/macos-ci`: builds the app and runs the integration test in
  the cloud (first time the integration test ran at all; it passes).
- 2026-10-07 — Claude — Leads module on `claude/leads`; opportunity detail/attachments on
  `claude/opportunity-attachments`; 1.4.127 reliability on `claude/lai-reliability-numbering-1.4.127`. None merged.
- 2026-10-07 — Claude — Heart favorites (常用); web trial rebuild script saved to `scripts/web-trial/`; branch rule
  D-013 recorded.
- 2026-10-06 — Claude — Working style changed (D-003); opportunities, team data, Zoho mail built.
