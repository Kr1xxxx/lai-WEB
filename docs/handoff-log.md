# Session log

Newest first. One entry per session: date — who (person or agent) — what was done, what is unfinished, next step.
When this file passes 200 lines, move older entries to `docs/handoff-log-archive.md`.
Entries before 2026-10-08 were reconstructed from `git log`; details are in `VALIDATION.md` and `docs/archive/`.

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
