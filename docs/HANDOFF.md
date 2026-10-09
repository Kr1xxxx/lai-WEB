# Handoff board

> The single "where are we now". Update it before you stop working; the session log lives in
> `docs/handoff-log.md`. Keep this file under 100 lines.

## Status (2026-10-09)

- Repository: https://github.com/Kr1xxxx/lai-app — `main` is version 1.4.126 (source); the owner's installed app
  is 1.4.125.
- On `main`: customers (list, detail, editor, contacts, follow-ups, segments, pool, duplicates, merge, tags, bulk
  create), orders, workbench, calendar/tasks, business stats, opportunities with custom sales flows, team data,
  Zoho mail, 常用 hearts, 设置/设置中心, three colour themes. Rules chosen while building: `VALIDATION.md`.
- UI pass merged 2026-10-09: Chinese date/month calendar (flatpickr, week starts Monday), one custom dropdown for
  every select, left rail without overlap, order numbers never cut off, `UI_CHECKLIST.md` + `scripts/ui-audit/`.
- Tests on `main`: `npm run test:model` 706 pass; `npm run test:e2e` 14 pass.
- 客户设置 batch A1 merged 2026-10-09 (PR #14, `main` 6941054): seven tabs under 客户 → 客户设置; rules in `VALIDATION.md`.
- Verification status per feature: `docs/features.json`. Most features were checked in a browser by earlier
  sessions; almost nothing has a recorded walk-through on the Mac app by the owner.
- Merge policy (D-014) and CI are live since PR #1; Mac build cadence (D-016) since PR #3. From PR #12 on, the
  decision runs in `merge-policy.yml` from `main`'s copy and merged branches are kept.
- Last Mac build on `main`: ea0ebfd (10th Claude merge), green.
- Web trial: Version 44 = `main` 91906aa, **older than `main`** (no 客户设置 yet): republish it (D-012). `rebuild.py` stops
  because `src/` gained `customer-settings-*.js|css`; either add their markers to the script, or compose from the old
  trial base by hand. The live page's body style is `background:#fff;color:#000` (check against the base you use).
  Then walk through 客户 → 客户设置 in the page and say which commit it was built from.
- How Claude works (D-017, waiting for 合并): Opus 5.5 high coordinates; subagents default to Sonnet 5.5 medium and
  run in parallel git worktrees (`.claude/settings.json`, `.claude/agents/`, rules in `CLAUDE.md`).

## Work waiting on branches (not in `main`)

Older sessions left these before the PR rule. Each must become its own PR from a branch that has the latest
`main` merged in; CI then decides small/big. Do not delete branches without the owner's OK (D-014 keeps D-013's
rule 5).

| Branch | What it is | Notes |
| --- | --- | --- |
| `claude/leads` | 线索 module: list, follow-ups, convert to customer, trash | Was on the web trial; owner has not accepted yet |
| `claude/opportunity-attachments` | Opportunity detail drawer, attachments, card drag | Touches `backend/` → big |
| `claude/lai-reliability-numbering-1.4.127` | 1.4.127: mail reliability, backups, totals, order numbers | Conflicts with the two above in `backend/server.js`, `backend/storage.js`, `src/business-ui.js`, `src/business.css` |
| `claude/web-trial-combined`, `claude/mail-skeleton-trial` | Old shared trial branch (= leads + attachments) | Obsolete once those two merge |
| `claude/mail-skeleton`, `claude/a-closeout-records` | Mail skeleton (superseded by real mail), A5 review notes | Probably obsolete; owner decides |
| `claude/macos-ci` | First macOS CI workflow | Folded into `.github/workflows/ci.yml`; obsolete |

## Task board

States: Todo / In progress / Done / Blocked / Cancelled. Only one task "In progress" at a time.

| # | Task | State | Owner | Notes |
| --- | --- | --- | --- | --- |
| 1 | Handoff rules, merge policy, e2e tests, CI with Mac build | Done | Claude | PR #1 merged 2026-10-09 |
| 2 | Turn the waiting branches above into PRs, one at a time; resolve the 1.4.127 conflicts | Todo | — | Order: leads → attachments → 1.4.127. The UI branches are done: PRs #6–#9 merged 2026-10-09 |
| 2b | 客户设置 batch A1: 客户分组 / 阶段 / 类型 / 建档黑名单 / 客户上限 / 查重展示 / 布局, wired into the editor, import, pool claim and detail page | Done | Claude | PR #14 merged 2026-10-09 (owner said 合并). Mac not walked through yet. Web trial still to republish |
| 2c | 客户设置 batch A2: 公海管理 (extend `poolRules`: several rules, reminder days, whitelist, claim limits, reason required; replace the old 公海规则 dialog button), 客户跟进规则 ("最近联系" is not "最近跟进"), 客户成交规则, 动态设置, 写跟进设置 | Todo | Claude | Next. Branch from latest `main`, label `major`, wait for 合并. Source: the owner's 小满 settings docs (collection ≠ authorization: do not copy the company's whole config, do not treat orders as opportunities, no formal data). Excluded: 企业微信, 钉钉, 内贸, 商城/购买/订购/采购; 回款, 海关, 外部沟通 stay deferred (D-006). Sharing/permissions/accounts need separate confirmation |
| 2a | Date and month fields: one Chinese calendar (flatpickr) instead of the system control | Done | Claude | PR #4 merged 2026-10-09 (owner said 合并); week starts on Monday; web trial republished (Version 44) |
| 3 | Owner walks through the Mac build from CI and records results in `docs/features.json` | Todo | Owner | Download the `Lai-app-<sha>` artifact from the PR's CI run |
| 4 | Real Zoho mailbox check (bind, receive, send) | Todo | Owner | Needs his real account (D-004) |
| 5 | Save the web trial's data shim (lives only in the published page) into `scripts/web-trial/` | Todo | — | Until then the trial cannot be rebuilt from the repo alone |
| 6 | More e2e coverage: orders, opportunities, mail page with the fake mail servers, settings | Todo | — | `tests/fixtures/fake-mail-servers.cjs` exists |
| 7 | Translate `ARCHITECTURE.md` / `VALIDATION.md` to English | Todo | — | After the waiting branches merge; they edit these files |
| 8 | Module reviews carried over: orders, workbench/calendar, stats (old A3–A5) | Todo | — | See `docs/archive/NEXT_STEPS.md` for the old acceptance criteria |
| 9 | 沟通 (communication) module — which chat tool | Blocked | Owner | Needs his choice |
| 11 | Opus coordinator + Sonnet subagents in worktrees (D-017) | Done | Claude | Waits for 合并 (touches `CLAUDE.md`) |
| 10 | Company-wide sharing (accounts, roles, central server) | Blocked | Owner | Large; needs decisions on where it runs and who sees what |

## Waiting on the owner

- Undecided offers: a unified motion pass (new drawers, dropdown menus, page switches have none); whether 客户类型 becomes a
  customer-list column (list fields are fixed to the captured list); a Mac build download to check the UI.
- Which of the waiting branches he still wants; whether obsolete branches may be deleted.
- 沟通 module: which chat tool (WhatsApp, WeChat, other).
- Company sharing: where it runs, accounts and permissions.

## Known risks

- Several sessions work at once; the web trial page is shared, so publishing from a branch hides other unmerged
  work until it merges.
- macOS CI minutes cost 10× on a private repository (2,000 free minutes ≈ 200 macOS minutes a month); Claude's
  Mac builds therefore run only every 10th merge (D-016), so a Mac-only break can sit on `main` for a while.
- Many unit tests assert on source text and break on refactors; `tests/e2e/` is the reference for behaviour.
- The Mac app is ad-hoc signed, not notarized: first launch needs right-click → 打开.
