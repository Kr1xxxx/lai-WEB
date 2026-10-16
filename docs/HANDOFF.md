# Handoff board

> The single "where are we now". Update it before you stop working; the session log lives in
> `docs/handoff-log.md`. Keep this file under 100 lines.

## Status (2026-10-16)

- Repository: https://github.com/Kr1xxxx/lai-WEB — `main` is source version 1.4.126; web trial v1.05 (built from `main` e5eab44).
- Desktop builds (Mac, Windows) are PAUSED (D-019): web version only. CI skips the Mac job; a manual run is still possible.
- On `main`: customers (list, detail, editor, contacts, follow-ups, segments, pool, duplicates, merge, tags, bulk create,
  客户设置), leads, orders with products and documents (报价单/PI/销售订单/发货通知, numbering, 单据记录), opportunities with flows,
  商机设置, products, workbench, calendar/tasks, business stats, team data, Zoho mail, roles + test accounts, 设置/设置中心,
  three themes, MiSans/Inter fonts. Business rules chosen while building: `VALIDATION.md`.
- `docs/features.json`: all 46 features walked in a browser (mail against the fake IMAP/SMTP servers only); none on the Mac app.
- Merge policy (D-014) runs in `merge-policy.yml` from `main`'s copy; merged branches are kept unless the owner says otherwise.
- How Claude works (D-017): Opus coordinates; Sonnet/Opus subagents in parallel git worktrees (`.claude/agents/`).
- Web trial: `python3 -I scripts/web-trial/build.py --publish --bump --out lai-artifact.html` (data stand-in
  `scripts/web-trial/data-shim.js`). Private Artifact https://claude.ai/artifact/QkmN2BDTSYYnox6BhzDNwD. The page shows its
  version top-left; every publish adds 0.01.

## Open PRs and branches

| What | Where | State |
| --- | --- | --- |
| Polish pass: tests, bug fixes, placeholder removal, UI audit fixes | `claude/gallant-bell-0m7uzb` | PR open; >500 `src/` lines and removed entries, so `needs-owner` + `major` |
| Data safety: incomplete-save guard, backup queue + tiered retention, before-delete backups, 409 rebase, mail forward/bulk/draft fixes | local `data-safety-pr2` (782b5f0, from e5eab44) | Opus-reviewed, fixes applied; becomes a second PR (touches `backend/`, `needs-owner`) after the first merges |
| Roles: departments, field permissions, layouts by role | PR #15 (`claude/project-thread-5ob5ux`) | Waiting for 合并; duplicate #16 closed 2026-10-16 |
| 1.4.127 reliability branch | `claude/lai-reliability-numbering-1.4.127` | Backend parts ported into `data-safety-pr2`; its numbering/finance `src/` changes were not ported (15 conflicts in `business-ui.js`) — re-evaluate against current code or drop |
| Old branches | ~60 merged or obsolete remote branches | Owner agreed to delete (2026-10-16); the session's safety rules blocked `git push --delete`, needs the owner to allow it |

## Task board

States: Todo / In progress / Done / Blocked / Cancelled.

| # | Task | State | Notes |
| --- | --- | --- | --- |
| 2 | Waiting branches → PRs | Done except 1.4.127 | See table above |
| 3 | Owner walks the Mac build | Blocked | Desktop builds paused (D-019) |
| 4 | Real Zoho mailbox check (bind, receive, send) | Todo (owner) | Needs his real account (D-004); fake-server e2e passes |
| 6 | More e2e: orders, opportunities, mail, settings | Done | `orders`, `opportunities`, `mail`, `settings-hub`, `features-walkthrough`, `customer-fixes`, `business-fixes`, `save-conflict` (data-safety PR) |
| 7 | Translate `ARCHITECTURE.md` / `VALIDATION.md` to English | Todo | |
| 8 | Module reviews (orders, workbench, stats) | Done | 2026-10-16 review: business/customer/data-safety/UI audits, fixes in the polish PR |
| 9 | 沟通 module — which chat tool | Blocked (owner) | Rail entry and flyout kept as the only placeholder besides Leads → 设置 (D-009) |
| 10 | Company-wide sharing (accounts, server) | Blocked (owner) | Roles are a local preview only: anyone can switch back to admin |
| 24 | Polish pass (this session) | In progress | PR from `claude/gallant-bell-0m7uzb`; then data-safety PR; then publish web trial |
| 25 | Split `src/app.js` (~5300 lines) and `business-ui.js` (~2700) by page | Todo | Many `tests/*.test.cjs` read source text; move them to behaviour tests while splitting |
| 26 | 写邮件给联系人 for extra contacts | Todo | `mail.composeFor` takes customer names only; needs an address argument in `mail-ui.js` |
| 27 | 新建商机: 客户 / 负责人 as real dropdowns | Todo | Now styled like dropdowns but still inputs with a datalist; needs controller changes in `business-ui.js` |

## Waiting on the owner

- 合并 for the polish PR, the data-safety PR (after it opens) and #15.
- Allow deleting old remote branches (blocked by this session's safety rules).
- Whether 待收款客户 (customer list, 成交客户分层) stays — it is close to 回款, which D-006 ruled out.
- Whether `claude/theme-pink-orange` and `claude/order-lines` (1–2 unmerged commits each, superseded by later work) may go.
- 沟通 module: which chat tool. Company sharing: where it runs, accounts and permissions.

## Known risks

- Several sessions work at once; the web trial page is shared, so publishing from a branch hides other unmerged work.
- With desktop builds paused, a Mac-only break can sit on `main` unnoticed until builds resume.
- Many unit tests assert on source text and break on refactors; `tests/e2e/` is the reference for behaviour.
- Timing tests (`perf-*`, mail time limits) can fail once under heavy load (several agents at once); rerun before judging.
- The Mac app is ad-hoc signed, not notarized: first launch needs right-click → 打开.
