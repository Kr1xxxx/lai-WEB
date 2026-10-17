# Handoff board

> The single "where are we now". Update it before you stop working; the session log lives in
> `docs/handoff-log.md`. Keep this file under 100 lines.

## Status (2026-10-17)

- Repository: https://github.com/Kr1xxxx/lai-WEB — `main` is source version 1.4.126 (9df7d37, #17 merged); web trial v1.12 built from `main` c9d3232 (#23 merged).
- The Mac app was removed (owner, 2026-10-17, D-026): web version only. The local backend stays as the data layer.
- On `main`: customers (list, detail, editor, contacts, follow-ups, segments, pool, duplicates, merge, tags, bulk create,
  客户设置), leads, orders with products and documents (报价单/PI/销售订单/发货通知, numbering, 单据记录), opportunities with flows,
  商机设置, products, workbench, calendar/tasks, business stats, team data, Zoho mail, roles + test accounts, 设置/设置中心,
  four themes (pink default, orange, 小满, 科技蓝; 小满 to be removed per D-029), MiSans/Inter fonts. Business rules chosen while building: `VALIDATION.md`.
- `docs/features.json`: all 46 features walked in a browser (mail against the fake IMAP/SMTP servers only); there is no Mac app any more (`mac` flag unused).
- Merge policy (D-014) runs in `merge-policy.yml` from `main`'s copy; merged branches are kept unless the owner says otherwise.
- How Claude works (D-027): Opus 5.5 high coordinates; Opus 5.5 medium subagents (explorer, worker, reviewer) in worktrees; Fable 5.1 `advisor` on call before plans, on repeated errors and before "done". The owner wants no questions: consult the advisor and decide (CLAUDE.md).
- UI direction (D-028): one component kit, shadcn/ui-style rules in 科技蓝 colours; 小满 style removed (D-029).
- Web trial: `python3 -I scripts/web-trial/build.py --publish --bump --out lai-artifact.html` (data stand-in
  `scripts/web-trial/data-shim.js`). Private Artifact https://claude.ai/artifact/Mg29sRpVLMTqvb1iYoZi7t (v1.12, published 2026-10-17; the older page QkmN2BDTSYYnox6BhzDNwD could not be opened from that session, so this is a new page). The page shows its
  version top-left; every publish adds 0.01.

## Open PRs and branches

| What | Where | State |
| --- | --- | --- |
| Polish pass: tests, bug fixes, placeholder removal, UI audit fixes | PR #17 | Merged 2026-10-16 (owner said 合并), `main` 9df7d37 |
| Data safety: incomplete-save guard, backup queue + tiered retention, before-delete backups, 409 rebase, mail forward/bulk/draft fixes; 待收款客户 group removed | PR #18 | Merged 2026-10-16 (owner said 合并), `main` 9579f5c |
| Roles: departments, field permissions, layouts by role | PR #15 | Merged 2026-10-16 (owner said 合并), `main` 892e284 |
| Settings take effect (客户设置 logic, scope leaks, 设置 fixes), D-022–D-025 | PR #19 | Merged 2026-10-17 (owner said 合并), `main` eb6ba6e |
| WhatsApp 沟通, export, lead settings, custom fields, rates, task rules, feature switches, D-022 build | PR #20 | Merged 2026-10-17 (owner said 后续自动合并), `main` 7dd7df4 |
| Settings-audit fixes, Mac app removed (D-026), 科技蓝 theme + new 工作台, top-bar overlap fix, order custom fields, agent tree (D-027), D-028/D-029 | PR #22 | Merged 2026-10-17 (后续自动合并), `main` cca83b1 |
| 1.4.127 reliability branch | `claude/lai-reliability-numbering-1.4.127` | Backend parts ported into `data-safety-pr2`; its numbering/finance `src/` changes were not ported (15 conflicts in `business-ui.js`) — re-evaluate against current code or drop |
| Old branches | 62 merged or obsolete remote branches | Owner agreed to delete (2026-10-16). The cloud session's GitHub proxy refuses branch deletion (`git push --delete` hangs up, API returns 403); needs a session or tool with delete rights |

## Task board

States: Todo / In progress / Done / Blocked / Cancelled.

| # | Task | State | Notes |
| --- | --- | --- | --- |
| 2 | Waiting branches → PRs | Done except 1.4.127 | See table above |
| 2i | 部门 + 本部门 scope + 部门管理员; field permissions; product layouts by role | Done | #15 merged |
| 3 | Owner walks the Mac build | Cancelled | Mac app removed (owner, 2026-10-17) |
| 4 | Real Zoho mailbox check (bind, receive, send) | Todo (owner) | Needs his real account (D-004); fake-server e2e passes |
| 6 | More e2e: orders, opportunities, mail, settings | Done | `orders`, `opportunities`, `mail`, `settings-hub`, `features-walkthrough`, `customer-fixes`, `business-fixes`, `save-conflict` (data-safety PR) |
| 7 | Translate `ARCHITECTURE.md` / `VALIDATION.md` to English | Todo | |
| 8 | Module reviews (orders, workbench, stats) | Done | 2026-10-16 review: business/customer/data-safety/UI audits, fixes in the polish PR |
| 9 | 沟通 module — WhatsApp (D-023) | Done (PR) | wa.me links, chat templates, import of exported chats, chat follow-ups; no receiving without a server (D-024) |
| 28 | Export, lead settings, custom customer fields, exchange rates, task rules, feature switches | Done (PR) | Settings kept in `laiSettings` (no schema change); see VALIDATION.md |
| 29 | Lead custom fields; custom fields in global search | Done (#21) | Lead list has fixed columns, so lead custom values show in editor, detail and export |
| 30 | Custom fields for orders | Done (PR) | Settings section on 设置, form, read-only list, export; no list columns (fixed), no order field permissions yet |
| 10 | Company-wide sharing (accounts, server) | Later | Cloudflare (D-024), not now; roles stay a local preview |
| 24 | Polish pass + data safety | Done | #17, #18 merged |
| 25 | Split `src/app.js` (~5800 lines), `business-ui.js` (~3100), `mail-ui.js` by page | Todo (planned) | 15-slice plan with advisor review; starts after the render fix (Q1); one file in one wave at a time |
| 31 | UI wave (advisor report 2026-10-17) | In progress | Q1+Q2 done (PR): frame drawn once, pages render into `main`, focus kept, order search patches rows; Q3+Q4 and 小满 removal in progress; then the component kit (D-028) page by page |
| 32 | Remove 小满 theme + classic skin (D-029) | In progress | Worker running; xiaoman shown as 科技蓝 |
| 33 | Full overlap sweep + CI test | Done (#23) | `scripts/ui-audit/overlap-sweep.cjs` + `tests/e2e/overlap-sweep.e2e.mjs`; 0 findings in 4 themes × 9 widths |
| 34 | Font subset (owner OK) | Done (#23) | MiSans hanzi cut to GB2312 + used chars; page 9.9 → 7.7 MB, pixel-identical; licence note in `vendor/fonts/SUBSET.md` |
| 26 | 写邮件给联系人 for extra contacts | Todo | `mail.composeFor` takes customer names only; needs an address argument in `mail-ui.js` |
| 27 | 新建商机: 客户 / 负责人 as real dropdowns | Todo | Now styled like dropdowns but still inputs with a datalist; needs controller changes in `business-ui.js` |

## Waiting on the owner

- Owner said 后续自动合并 (2026-10-17); Claude merges its own PRs once CI is green.
- Whether `claude/theme-pink-orange` and `claude/order-lines` (1–2 unmerged commits each, superseded by later work) may go.

## Known risks

- Several sessions work at once; the web trial page is shared, so publishing from a branch hides other unmerged work.
- Many unit tests assert on source text and break on refactors; `tests/e2e/` is the reference for behaviour.
- Timing tests (`perf-*`, mail time limits) can fail once under heavy load (several agents at once); rerun before judging.
