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
- Tests on `main`: `npm run test:model` 774 pass; `npm run test:e2e` 30 pass (A2 merged). The web-trial branch adds 6 shim tests.
- 客户设置 batch A1 merged 2026-10-09 (PR #14, `main` 6941054): seven tabs under 客户 → 客户设置; rules in `VALIDATION.md`.
- Verification status per feature: `docs/features.json`. Most features were checked in a browser by earlier
  sessions; almost nothing has a recorded walk-through on the Mac app by the owner.
- Desktop builds (Mac, Windows) are PAUSED since 2026-10-10 (D-019): web version only. CI skips the Mac job; manual run still possible.
- Merge policy (D-014) and CI are live since PR #1; Mac build cadence (D-016, paused) since PR #3. From PR #12 on, the
  decision runs in `merge-policy.yml` from `main`'s copy and merged branches are kept.
- Last Mac build on `main`: 302e6b2 (20th Claude merge, PR #19; the next one is due after the 30th), green: build, integration test and package passed; artifact `Lai-app-302e6b2…` in that CI run.
- Web trial: the old page (Version 45, `main` 6941054, A1) could not be read from the current account, so the page was rebuilt
  from the repo alone: `python3 -I scripts/web-trial/build.py --publish --out lai-artifact.html` (data stand-in:
  `scripts/web-trial/data-shim.js`). New private Artifact https://claude.ai/artifact/QkmN2BDTSYYnox6BhzDNwD, Version 2 built from `main`
  2475597 (A2 + rail pill). It holds no data from the old page. `rebuild.py` still works for an existing live page.
- How Claude works (D-017, PR #15 merged 2026-10-09): Opus 5.5 high coordinates; subagents default to Sonnet 5.5 medium and
  run in parallel git worktrees (`.claude/settings.json`, `.claude/agents/`, rules in `CLAUDE.md`).

## Work waiting on branches (not in `main`)

Older sessions left these before the PR rule. Each must become its own PR from a branch that has the latest
`main` merged in; CI then decides small/big. Do not delete branches without the owner's OK (D-014 keeps D-013's
rule 5).

| Branch | What it is | Notes |
| --- | --- | --- |
| `claude/leads` | 线索 module: list, follow-ups, convert to customer, trash | Now in PR from `claude/project-thread-z9rz5t`; keep branch until merged |
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
| 2 | Turn the waiting branches above into PRs, one at a time; resolve the 1.4.127 conflicts | Todo | — | Order: leads (PR open) → attachments → 1.4.127. The UI branches are done: PRs #6–#9 merged 2026-10-09 |
| 2b | 客户设置 batch A1: 客户分组 / 阶段 / 类型 / 建档黑名单 / 客户上限 / 查重展示 / 布局, wired into the editor, import, pool claim and detail page | Done | Claude | PR #14 merged 2026-10-09 (owner said 合并). Mac not walked through yet. Web trial Version 45 (built from 6941054) |
| 2c | 客户设置 batch A2: 公海管理 (extend `poolRules`: several rules, reminder days, whitelist, claim limits, reason required; replace the old 公海规则 dialog button), 客户跟进规则 ("最近联系" is not "最近跟进"), 客户成交规则, 动态设置, 写跟进设置 | Done | Claude | PR #20 merged 2026-10-09 (owner said 合并), `main` 7e74221; Mac app not walked through. Source was the owner's 小满 settings docs (collection ≠ authorization). Excluded: 企业微信, 钉钉, 内贸, 商城/购买/订购/采购; 回款, 海关, 外部沟通 stay deferred (D-006). Sharing/permissions/accounts need separate confirmation |
| 2d | 客户设置 batch B1: 判重设置 (9 fields, allow/block/off) and 来源设置 (two-level list, hide, sort) as new 客户设置 tabs | Done | Claude | PR #33 merged 2026-10-09 (owner said 合并), web trial Version 9. 商机来源 not wired to the list yet; Mac not walked through. Owner excluded 工作流, 审批流, 营销设置 (2026-10-09). Still open in `docs/xiaoman/README.md`: 自定义字段/必填, 功能开关, 线索设置, 商机设置, 产品设置, 单据模板, 费用设置, 汇率 etc.; suggested next: 产品设置 and 单据模板 (报价单/PI) |
| 2a | Date and month fields: one Chinese calendar (flatpickr) instead of the system control | Done | Claude | PR #4 merged 2026-10-09 (owner said 合并); week starts on Monday; web trial republished (Version 44) |
| 3 | Owner walks through the Mac build from CI and records results in `docs/features.json` | Todo | Owner | Download the `Lai-app-<sha>` artifact from the PR's CI run |
| 4 | Real Zoho mailbox check (bind, receive, send) | Todo | Owner | Needs his real account (D-004) |
| 5 | Save the web trial's data shim into `scripts/web-trial/` | Done | Claude | `data-shim.js` + `build.py` (this branch); the trial can now be built from the repo alone. Data from the old page is not carried over |
| 6 | More e2e coverage: orders, opportunities, mail page with the fake mail servers, settings | Todo | — | `tests/fixtures/fake-mail-servers.cjs` exists |
| 7 | Translate `ARCHITECTURE.md` / `VALIDATION.md` to English | Todo | — | After the waiting branches merge; they edit these files |
| 8 | Module reviews carried over: orders, workbench/calendar, stats (old A3–A5) | Todo | — | See `docs/archive/NEXT_STEPS.md` for the old acceptance criteria |
| 9 | 沟通 (communication) module — which chat tool | Blocked | Owner | Needs his choice |
| 11 | Opus coordinator + Sonnet subagents in worktrees (D-017) | Done | Claude | PR #15 merged 2026-10-09 (owner said 合并) |
| 12 | 左栏选中效果改成玫红药丸（图标加文字都在药丸里），粉色、橙色界面 | Done | Claude | PR #22 merged 2026-10-09 (owner said 合并), `main` 2475597; web trial republished (Version 2). Mac not walked through |
| 13 | App icon: 美金投币口 design (定稿 · B1 细缝, dark base) replaces `assets/AppIcon.icns`; source `assets/AppIcon.svg` | In progress | Claude | Branch `claude/project-thread-vylsq4`; touches `assets/`, so it waits for the owner's 合并. Mac app not looked at yet |
| 14 | Unified motion: rail pill eases (160 ms), hover timings use `--motion-*` tokens, guard test | Done | Claude | PR #27; drawer/tab 240–300 ms timings left as they are |
| 14 | 顶栏左上角加上新图标（美金投币口），在 "来财Lai" 字样前面 | Done | Claude | PR #28 merged 2026-10-09 (`main` 183718f), owner rule: under 500 lines merges without asking. The .icns (#25) only reaches the Mac Dock; this adds the icon to the page top bar. Web trial republished (Version 5). Text colours not changed |
| 15 | Motion curves ported from Arc Library (MIT): `--ease-out/-exit/-in-out/-drawer`; menus, popovers, drawers use them | Done | Claude | Real arc-library components need a dependency decision |
| 16 | Removed reduced-motion handling everywhere (owner decision): CSS, scripts, helper, tests, docs; animations always run | Done | Claude | Old `scripts/*-acceptance.mjs` still emulate it; not run in CI |
| 17 | 界面配色默认粉色；设置里每个配色选项加预览图（选项顺序：粉色、橙色、小满） | Done | Claude | PR #32；已选小满或橙色的人不变 |
| 17 | UI detail polish from make-interfaces-feel-better (font smoothing, tabular digits in tables and order/opportunity lists, press scale 0.96, no `transition: all`) | Done | Claude | Owner wants these rules applied on every UI change |
| 15 | 顶栏去掉 "Lai" 文字，"来财" 字标改成更圆润的互联网风格 | Done | Claude | Inline SVG text with round-joined stroke; macOS 圆体 (Yuanti SC) first in the font list, so no font is bundled. "AI" tag and version kept |
| 18 | 点顶栏版本号弹出版本更新历史（`src/changelog.js` 是维护的来源，有用户看得见的改动就往最新一版里加一条） | In progress | Claude | PR touches `scripts/build.py` + `src/template.html` (new script marker), so CI runs the Mac build; under 500 lines, merged under the owner's 2026-10-09 rule |
| 23 | Saves send only what changed (`POST /api/save-changes`, D-020); fallback to the full save; paging on read left for the move to a server | In progress | Claude | PR #43; touches `backend/storage.js`/`server.js`; 10,000 customers: save request 11 MB→1 KB, 464→18 ms |
| 22 | Customer list speed with many customers: orders grouped once in `buildCustomers`, save body limit 16→64 MB, speed checks (`tests/e2e/perf-customers.mjs`, `perf-customers.e2e.mjs`, `tests/perf-model.test.cjs`) | In progress | Claude | PR #40; touches `backend/server.js` (one constant). 10,000 customers: open a customer 4.9→0.4 s, save a follow-up 14.4→2.0 s |
| 19 | Applied transitions.dev (Jakub Antalik) where it fits: toast fades with blur and scale (open slower than close), switch thumb springs. Tokens in `ui-tokens.css` | In progress | Claude | Skill's reduced-motion guards left out (owner decision); other 30 transitions not adopted |
| 20 | Click outside closes popups without data entry (version history, 关于, 客户操作, 管理常用, confirmations, 导入记录, 标签管理 none…); popups with forms/inputs and 新建/编辑客户, 导入, 客群, 显示设置 stay open | In progress | Claude | Press and release must both be outside (dragging in or out does not close) |
| 10 | Company-wide sharing (accounts, roles, central server) | Blocked | Owner | Large; needs decisions on where it runs and who sees what |

## Waiting on the owner

- Undecided offers: whether 客户类型 becomes a
  customer-list column (list fields are fixed to the captured list); a Mac build download to check the UI.
- Which of the waiting branches he still wants; whether obsolete branches may be deleted.
- 沟通 module: which chat tool (WhatsApp, WeChat, other).
- Company sharing: where it runs, accounts and permissions.

## Known risks

- Several sessions work at once; the web trial page is shared, so publishing from a branch hides other unmerged
  work until it merges.
- macOS CI minutes cost 10× on a private repository (2,000 free minutes ≈ 200 macOS minutes a month); Claude's
  Mac builds therefore ran only every 10th merge (D-016); now they are paused altogether (D-019), so a Mac-only break can sit on `main` unnoticed until builds resume.
- Many unit tests assert on source text and break on refactors; `tests/e2e/` is the reference for behaviour.
- The Mac app is ad-hoc signed, not notarized: first launch needs right-click → 打开.
