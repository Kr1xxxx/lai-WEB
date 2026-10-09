# Session log

Newest first. One entry per session: date — who (person or agent) — what was done, what is unfinished, next step.
When this file passes 200 lines, move older entries to `docs/handoff-log-archive.md`.
Entries before 2026-10-08 were reconstructed from `git log`; details are in `VALIDATION.md` and `docs/archive/`.

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
