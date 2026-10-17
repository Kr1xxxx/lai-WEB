# Session log

Newest first. One entry per session: date — who (person or agent) — what was done, what is unfinished, next step.
When this file passes 200 lines, move older entries to `docs/handoff-log-archive.md`.
Entries before 2026-10-08 were reconstructed from `git log`; details are in `VALIDATION.md` and `docs/archive/`.

- 2026-10-17 — Claude — After #21: settings-audit fixes (线索设置 hub entry, Mac-only data-folder button removed, customer
  import of custom fields, module-off hides settings, 默认跟进人 no longer overwritten, wording); Mac app removed (D-026);
  科技蓝 theme + rebuilt 工作台 (all themes); top-bar overlap fix + e2e at 1024–1680px; order custom fields (workflow:
  build → 3 reviewers → fix). Two background workers were stopped by an owner interrupt at 02:44 and resumed from WIP
  commits. Advisor (Fable) UI review: no shared components, full re-render on every click, pink used as paint; plan in
  HANDOFF #31. Owner decisions: D-027 agent tree, D-028 kit in 科技蓝, D-029 remove 小满, no questions (ask the advisor).
- 2026-10-17 — Claude — Task 29: lead custom fields (线索设置 → 自定义字段, editor, detail, export, conversion copies to
  same-name same-type customer fields, role field permissions) and top-bar search over customer custom fields (全部 and a
  single custom field scope). model 1458 / e2e 294 green, UI audit pass (170).
- 2026-10-17 — Claude — Owner said 合并: merged #19, `main` eb6ba6e; then 后续自动合并. Restarted the branch from it and
  merged the next wave: WhatsApp 沟通 (links, templates, chat import, chat follow-ups), 导出, 线索设置, custom customer
  fields, exchange rates with order snapshots, task rules, feature switches, D-022 (company details in one place, team
  data 本人 scope, tasks with owners). Opus review findings fixed; e2e harness race fixed (wait for boot before changing
  the hash). model 1439 / e2e 285 green, UI audit pass. Permission seams to note: 设置 edits company/bank details with
  `settings.general` only; chat send/import work on 公海 customers with `pool.view` only. Merged as #20 (`main` 7dd7df4);
  web trial v1.09 published from it.
- 2026-10-16 — Claude — Owner said 合并 for #15: brought main (#17, #18) into its branch (merge commit, tests green), merged
  #15, `main` 892e284; web trial v1.08. Owner decisions recorded: pink default (D-008), D-022 company details / team data
  scope / personal tasks, D-023 WhatsApp, D-024 Cloudflare later, D-025 audit before complex tasks. Settings audit (three
  reviewers) → fixes S1 (客户设置 logic), S2a (customer pages), S2b (business pages), plus #15-area fixes (opportunity
  required trap, stage labels, product import, member rename cascade, new permission keys); all merged here with main.
  WhatsApp and six-feature audits done; plans kept locally in docs/whatsapp-plan.md and docs/next-features-plan.md;
  model pieces built on local branches feat-wa-model, feat-wa-ui, feat-export-model, feat-field-model.
- 2026-10-16 — Claude — Owner said 合并: merged #18 (data safety), `main` 9579f5c. Web trial v1.07 published from it (same new page).
  Owner asked whether every setting is finished and takes effect; a settings audit was started.
- 2026-10-16 — Claude — Owner said 合并: merged #17 (polish pass), `main` 9df7d37. Restarted `claude/gallant-bell-0m7uzb` from it and
  merged the Opus-reviewed data-safety branch (conflicts only in the `model.js` export list and `VALIDATION.md`); owner said to
  remove the 待收款客户 group (done). model 1067 / e2e 171 green. Owner allowed deleting old branches, but the cloud GitHub proxy
  refuses deletes (push hangs up, API 403). Web trial v1.06 published from `main` 9df7d37.
- 2026-10-16 — Claude — Owner asked to review the repo, then "hand every task to subagents; polish the app, fix problems,
  keep improving features". Opus coordinated 15 subagents: four read-only audits (customer pages, business pages, data safety
  + 1.4.127 branch, UI audit), three e2e slices (orders/opportunities, mail/settings against fake mail servers, walkthrough of
  the 17 unverified features → all 46 now browser-verified), fix batches A (lead duplicate index, order month follows date,
  order client matching), B (decimal prices, order numbers never reused, opp detail buttons from 单据记录, workbench open-opp
  count, local dates, calendar order permission, prefix check, live opp search, 同步→导入), C1 (batch speed on 10k
  customers, NFKC name dedupe, rename repoints opps/tasks, merge keeps all fields, bad segment skipped, dedupe junk), C2
  (draft no longer blocks navigation, row cache, stage/boolean filters, tag permissions, merge picker, real opps in 商机和订单,
  回款 columns and ~20 placeholder entries removed per D-003/D-006), D (UI audit fixes, audit false positive). Data-safety
  batch kept on local `data-safety-pr2` for a separate needs-owner PR. Closed duplicate PR #16 (owner agreed). Branch deletion
  was blocked by the session's safety rules. Next: owner 合并, then the data-safety PR, then publish the web trial.
- 2026-10-16 — Claude — #14 merged. Owner asked for 部门, 按角色分配产品布局 and 按字段控制权限. Built on
  `claude/project-thread-5ob5ux` (PR #15) in four worktrees: role model v2 (departments, 本部门, 部门管理员, field levels,
  `keepLocked`, product layouts, split perms), role/member pages, products + team data, leads + opportunities, customers.
  Known gap: hidden opportunity fields may still show on the customer detail opportunity list, the workbench and quote/PI generation.
- 2026-10-16 — Claude — Merged lai-WEB #11 (owner said 合并). Owner asked for 角色分配 with test accounts, roles 管理员 and 业务
  (screenshots of 小满 角色权限 / 编辑角色). Built on `claude/project-thread-5ob5ux` in three parallel worktrees: `src/role-model.js`
  (`laiSettings.roles`; 系统管理员 locked with all perms; 业务 defaults from 小满 普通用户; scope self/all; `can`, `canSee`,
  `canOpen` + `PAGE_PERMS`), `src/role-ui.js` + routes `roles`/`members` under 企业管理, avatar-menu account switch and customer
  scope/guards in `app.js`, guards and 本人 scope in business pages, workbench, settings hub and mail send. Also repaired
  `docs/features.json` (the #11 merge had fused the doc-numbering and ui-fonts entries). Not done: 本部门, layouts by role.
- 2026-10-16 — Claude — Owner said 合并: merged lai-WEB #12 (fonts), `main` ea17189. The live web trial was already v1.03,
  published by another thread from the unmerged branch `claude/project-thread-5ob5ux` (opportunity settings, document numbering,
  product sync, lead dedupe). To keep that, v1.04 was built from that branch merged with `main` (only docs conflicted) and
  published (Artifact Version 49); checked in the browser: MiSans and Inter loaded, 关于来财Lai names them, no console errors.
  `version.json` set to 1.04 here (that branch merged as #11 with 1.03; this PR takes 1.04).
- 2026-10-15 — Claude — Owner asked for four 小满 gaps; built in parallel worktrees and merged on `claude/project-thread-5ob5ux`:
  商机设置 (route `opp-flows` renamed 商机设置: tabs 销售流程/输单原因/商机字段; `laiSettings.opportunitySettings`; new opportunity fields
  sources/type/leadId/number/custom), 判重 新线索与已有客户 (`customerSettings.leadDedupe`, default all block), 产品 同步 from xls/xlsx/csv
  (`laiProductSyncTasks`, undo newest) and 布局 (per form/detail, roles wait for accounts), 单据 编号规则 + `laiDocuments` + 单据记录 +
  报价单/PI from an opportunity. Fixed the unclosed `.lead-timeline {` in `src/business.css` (everything after it was nested and
  ignored, incl. opportunity detail/attachment styles) and removed two green colours that this exposed. model 952 / e2e 76 green;
  ui-audit pink 1440×900 passes. Not done: 商机自动化设置, 归属部门, 销售订单/发货通知 from 商机, layout by role.
- 2026-10-15 — Claude — Owner asked to unify all fonts: MiSans for Chinese, Latin font of Claude's choice (Inter). Vendored
  `vendor/fonts/` (MiSans VF 4.009, 56 official slices from npm `misans@5.0.0`; Inter 4 variable latin + latin-ext from
  `@fontsource-variable/inter@5.3.0`, OFL); `scripts/build.py` `font_faces_css()` inlines them as data URIs at the new
  `<!--UI_FONTS-->` marker, so the Mac app and the web trial both work offline (CSP already allows `font-src data:`).
  `--font-ui` is `"Inter", "MiSans VF", system fallbacks`; the four CSS files with their own stacks and the glass skin's
  Bricolage numbers now use the token. MiSans credit added to 关于来财Lai (its license requires it). Kept on purpose: the
  rounded 来财 wordmark (Yuanti SC), printed documents and the mail viewer (separate documents). Page grows from 2.9 MB to
  9.2 MB. Tests: `tests/ui-fonts.test.cjs`, `tests/e2e/fonts.e2e.mjs`. Not done: Mac app not looked at (builds paused).
- 2026-10-15 — Claude — Owner said 合并: merged lai-WEB #1, #3, #4, #6, #8 in that order (each branch carried the previous one so
  conflicts were solved once; two decisions were both D-019, the changes-only save is now D-020). Earlier the same day: #9
  (date test), #5 (desktop pause), #2 (customer list speed). Web trial v1.02 published from `main` a34ddbf (Artifact Version 47)
  and checked in the browser: products, order items with the 4 document buttons, opportunities, no console errors. Rulebook and
  handoff now name repo Kr1xxxx/lai-WEB. Not done: lai-WEB #7 (duplicate of #8) is still open; small PRs did not merge by
  themselves on lai-WEB (#9 was merged by hand), the merge policy workflow needs a look.
- 2026-10-15 — Claude — Owner asked to start 订单选产品 and then 报价单/PI from an order. Built on PR #47's branch: order form section 产品明细 (pick from `laiProducts`, qty, price; amount and 产品 follow the items and are read-only while items exist), model in `src/business-model.js` (`cleanItems`, `itemsTotal`, `itemFromProduct`, `linkItems`, `docLines`; `upsertOrder` stores `items`), opportunity → order carries priced products as items. Four 生成单据 buttons in the order form show a live preview (the order card widens) with print. New `tests/e2e/order-products.e2e.mjs`; fixed `customer-flows-a2` which used a fixed 2026-09-20 deal date and started failing once that date drifted near the 30-day rule (it failed on `main` too). GitHub Actions still refuses to start jobs (annotation: "recent account payments have failed or your spending limit needs to be increased"), so nothing here ran in CI; PRs #40 and #46 not merged for that reason. Not done: document numbering, saved documents, mail.
- 2026-10-10 — Claude — Added 单据模板 (交易 → 单据模板) on the same branch as 产品 (PR #47): `src/doc-template-model.js`, `src/doc-template-ui.js`, route `doc-templates` in `business-ui.js`, rail entry, `.dt-*` styles, `tests/doc-template-model.test.cjs`, `tests/e2e/doc-templates.e2e.mjs`. Four document types (报价单, 形式发票, 销售订单, 发货通知) with editable title, columns, terms, footer, bank/signature switches, live preview from the product list, print via the browser; company and bank info shared. Settings in `laiSettings.docTemplates` (no schema change). Not done: making documents from real orders or opportunities, numbering rules. GitHub Actions failed within 2 seconds on every PR from 13:07 on 2026-10-10 (not this diff); noted on PR #47.
- 2026-10-10 — Claude — Owner said 继续, and that the desktop (Mac) build is paused: web trial only for now. Built 产品 (交易 → 产品): `src/product-model.js`, `src/product-ui.js`, wiring in `business-ui.js`, new rail entry. Settings: 分组 (two levels), 字段 (21 fields, show/required), 规格 (type + values); product list with search, create/edit/delete. Rules in `VALIDATION.md`. model 830 / e2e 46 green; UI audit pink 1440×900 on customers, order-list, products: 0 errors, 0 native selects. Not done: orders/quotes do not pick from the product list; 同步, 布局, 产品回收箱, 自定义字段. Next: 单据模板 (报价单/PI).
- 2026-10-09 — Claude — Lock chose "只传改动 + 分页" (step 1 toward a server). Done: changes-only saves (D-020): `POST /api/save-changes` + `applyChanges` in `backend/storage.js`, `snapshotState/diffState` in `src/model.js`, `persist()` in `src/app.js` with fallback to full `/api/save`; tests `tests/save-changes.test.cjs` (delta == full save over 14 edit kinds, stale revision, rollback). At 10,000 customers: save request 464 ms / 11 MB → 18 ms / 1 KB, saving a follow-up in the page 2.0 s → 0.6 s; 20,000: 4.2 s → 1.2 s. Not done: paging on read. The list already shows 20 rows per page, but the page still loads every customer at start (1.6 s / 11 MB at 10k); real server-side paging means moving search/sort/segments/counts to the server, i.e. part of the move to a server. Web trial shim answers `/api/save-changes` with 404 so it falls back to full saves.
- 2026-10-09 — Claude — Opportunity attachments (task 2, second branch): merged `claude/opportunity-attachments` into latest `main` (5 conflicts: docs, `business-ui.js`, `business.css`, `opportunity-ui.js`; undo bar + detail drawer joined with the new view switch and source banner). New CSS brought in line with the motion tokens, no reduced-motion block, no blue literals. Backend change is one new file `backend/opportunity-files.js` plus 3 routes and a missing-file-tolerant backup; no schema change. Added `tests/e2e/opportunity-attachments.e2e.mjs` and 3 changelog lines. Not done: Mac walk-through (file preview, 另存为 to Downloads). Next: 1.4.127 (conflicts with this PR; version bump needs the owner).
- 2026-10-09 — Claude — Owner asked for a version number at the top-left of the web trial, +0.01 for every update, starting at 1.01,
  and for the version to be reported at the end of every update. `scripts/web-trial/version.json` + `build.py` (the top bar's version
  chip next to the logo shows `v1.01` instead of the app's 1.4.x, which stays in the 关于来财 drawer and the chip's tooltip; `--bump`
  adds 0.01); the rule is in `AGENTS.md` (Web trial). A first try with a separate fixed label collided with the logo and the search box
  at narrow widths and was dropped. Checked at 1440×900 / 1280×720 / 1100×700 in all three skins. Published v1.01 (Artifact Version 3).
  Tests: `test_release_tools.py` (9), model 780.
- 2026-10-09 — Claude — Lock asked for a serious test of "list gets slow with many customers". Added `tests/e2e/perf-data.mjs` (synthetic customers/orders), `perf-customers.mjs` (table at any size: `node tests/e2e/perf-customers.mjs 1000,10000`), `perf-customers.e2e.mjs` and `tests/perf-model.test.cjs` (budgets). Cause: `buildCustomers` filtered all orders once per customer (customers × orders); every detail open/save re-ran it. Fixed by grouping orders once (10k customers: open customer 4.9 s → 0.4 s, save a follow-up 14.4 s → 2.0 s, first load 4.5 s → 2.0 s). Also raised the save body limit 16 MB → 64 MB (about 14,500 customers hit 413 before, so saves would have failed). Not done: every save still sends the whole dataset (11 MB at 10k, 22 MB at 20k); incremental save needs a backend/schema change and the owner's OK. Mac-app path not measured (same page + backend code, no Mac here).
- 2026-10-10 — Claude — Desktop builds paused (owner: Windows/Mac paused, web version only for now; D-019). `PAUSED = true` in `scripts/mac-cadence.mjs` makes the CI Mac job and the every-10th-merge build on `main` skip (a manual CI run still builds); `CLAUDE.md`, `AGENTS.md`, README, PR template, D-016 status and HANDOFF say so; nothing deleted. There was never a Windows build. Not done: no Mac build was run to check the pause. Resume: set `PAUSED` to false.
- 2026-10-09 — Claude — Acceptance found that pressing outside a popup and releasing inside closed it. The outside-click close now needs both press and release outside (`overlayReleaseTarget` in `src/app.js`); e2e case added.
- 2026-10-09 — Claude — Owner asked: non-important popups close on an outside click, popups being filled in (forms, 商机, customer info) do not. Before, only 显示字段 and 功能说明 closed that way. Now every drawer closes unless it holds a form/input/textarea/select or is 新建/编辑客户, 导入, 客群, 显示设置. Pointer must go down outside too. New e2e `popup-outside-click`.
- 2026-10-09 — Claude — Owner asked to use the Jakubantalik repos. Only `transitions.dev` fits (CSS transitions as an agent skill; `transitions-dev` is its mirror, the others are React effects). Took its toast (blur + scale, open 350ms / close 250ms) and switch (springy thumb) and added their tokens to `src/ui-tokens.css`; left out its `prefers-reduced-motion` guards. Changelog line added. Not adopted: the other transitions; owner can pick more.
- 2026-10-09 — Claude — PR #33 (判重设置 + 来源设置) merged after the owner wrote 合并 (the PR conflicted with `main` and was marked `needs-owner`); web trial republished as Version 9 and the two tabs checked on the published file. Owner then ruled out 工作流, 审批流 and 营销设置: marked 排除 in `docs/xiaoman/README.md`, task 2d set to Done. Next: owner picks the next batch (suggested 产品设置 + 单据模板).
- 2026-10-09 — Claude — Owner asked that the top-bar version number open the version update history. `v1.4.126` is now a button (`data-action="version-history"`, drag-region exclusion already covers buttons) that opens the drawer from `src/changelog.js` (new script, marker `<!--CHANGELOG-->` in `src/template.html` and `scripts/build.py`). The repo had no changelog and no version bumps (everything is 1.4.126; nothing before it is recorded), so the list starts at 1.4.126 with this day's user-visible changes written from the handoff log. Maintenance rule is a comment at the top of `src/changelog.js` (a test checks the newest release matches `package.json`). Tests 819 / 38. Not done: Mac app not looked at.
- 2026-10-09 — Claude — Owner asked to drop "Lai" from the top bar and make 来财 rounder and more internet-style. The wordmark is now an inline
  SVG `<text>` (`.brand-cn` in `src/customer-replica.css`): Yuanti SC (built into macOS) first, other fonts fall back, and a round-joined
  stroke softens corners on any font. Not done: Yuanti SC could not be rendered here (no such font on this machine), so the real Mac
  look is unchecked; `AI` tag and version badge kept. Tests 815 / 35.
- 2026-10-09 — Claude — Lock asked whether the 小满 settings replication was unfinished; it was (only 客户设置 A1/A2 were done) and he said to continue. Added two 客户设置 tabs: 判重设置 (allow/block/off per field, checked on save for new values only; extras listed on 客户查重) and 来源设置 (two-level list with hide/sort/rename; feeds customer editor and lead source dropdowns). Rules in `VALIDATION.md`; README comparison table updated (also fixed A2 rows that still said 进行中). model 812 / e2e 37 green; UI audit pink 1440×900 customers: 0 errors, 0 native selects, 0 rail overlaps. Not done: Mac walk-through; 商机来源 not wired; 新线索判重 page; the rest of the 未做 rows. Next: 自定义字段/必填 (may need a schema decision — ask first).
- 2026-10-09 — Claude — 界面配色默认改为粉色（没选过配色的人和新数据都是粉色；已经选了小满或橙色的人不变），设置里每个配色选项加了预览小图（左栏、顶栏、两张卡片）。选项顺序：粉色（默认）、橙色、小满。改动在 `src/app.js`、`business-ui.js`、`settings-hub.js`、`ui-tokens.css`（`:root` 默认值换成粉色）、`business.css`（预览图样式）。测试：`tests/ui-baseline.test.cjs`。
- 2026-10-09 — Claude — Owner saw no new logo in the web trial: #25 only replaced `assets/AppIcon.icns` (Mac Dock/Finder); the page's top-left
  brand was text only. Added the same icon as an inline SVG (28px) before 来财Lai in the topbar (`src/app.js`, `.brand-mark` in
  `src/customer-replica.css`). Checked at 1440×900 on the built trial page; tests 803 / 35. PR #28 merged (`main` 183718f); web trial republished as Version 5 from that commit (live page differed from the build only by this change). Not done: Mac build not looked at.
- 2026-10-09 — Claude — Fix for the previous entry: the order/opportunity list is built from `.op-row` spans, not `<td>`, so the tabular-digits rule did not reach it; added `.op-row, .op-grid` to the rule in `src/styles.css`. Verified in the rebuilt web trial that the amounts are now `tabular-nums`.
- 2026-10-09 — Claude — UI polish from Jakub Krehel's make-interfaces-feel-better (Lock saw a before/after image and said to use it from now on): font smoothing, tabular numbers in tables, text-wrap balance/pretty, buttons press to scale(0.96), tab buttons no longer `transition: all`; all in `src/styles.css` and one line in `customer-detail.css`. model 805 green. Not done: other rules (concentric radius, layered shadows, hit areas, icon stroke) are not applied yet; apply them on new UI work. Next: keep using the rules on every UI change.
- 2026-10-09 — Claude — Lock: remove reduced-motion handling completely (second pass: `customer-motion.js` helper, its tests, `VALIDATION.md` wording; no user-facing setting existed). Older `scripts/*-acceptance.mjs` still emulate `prefers-reduced-motion` and assert the old fades; they need the built Mac app, are not run in CI, and are left for the owner to decide.
- 2026-10-09 — Claude — Lock: no more reduced-motion handling. Removed every `prefers-reduced-motion` media block (8 CSS files) and the `matchMedia` checks in `app.js`, `customer-motion.js`, `customer-select.js`, `customer-editor-ui.js`, `activity-category-navigation.js`; motion always runs. Three tests that asserted the old behaviour were changed to assert the opposite, plus a new guard in `tests/motion-tokens.test.cjs`. model 805 / e2e 35 green (one e2e templates test failed once on the first run and passed on rerun). Not done: no `docs/DECISIONS.md` entry (rulebook file; Lock's call is recorded in `VALIDATION.md`).
- 2026-10-09 — Claude — Arc Library motion (Lock: use arc-library for animations, try the most common ones): its components are React + `motion`, so they cannot be dropped into this plain-JS app (a new dependency needs the owner). Ported its MIT motion curves instead: `--ease-out` (enter), new `--ease-exit`, `--ease-in-out`, `--ease-drawer` in `src/ui-tokens.css`; menu/popover/dropdown enter and exit animations in `styles.css` and `customer-replica.css` now use them; durations unchanged. model 804 / e2e 35 green. Next: Lock tries the web trial; real arc-library components (e.g. a gliding pill) need his OK for a dependency.
- 2026-10-09 — Claude — Unified motion (owner approved the plan): left-rail pill now eases in/out (160 ms, `--ease-out`); loose 0.12s/120ms/150ms hover timings in 4 CSS files use `--motion-fast` + `--ease-out`; new `tests/motion-tokens.test.cjs`; `nav-favorites` test follows the token. model 803 / e2e 35 green. Not done: the 300 ms drawer/tab timings stay as they are (deliberate, tests depend on them); UI audit and Mac look not run. Next: owner looks at the rail in the Mac build.
- 2026-10-09 — Claude — Leads (task 2, first branch): merged `claude/leads` into latest `main` on `claude/project-thread-z9rz5t` (8 conflicts in docs, `build.py`, `template.html`, `app.js`, `rail-menu.js`, `business.css`, favorites test; leads entry re-wired into the current rail menu). Fixes: favorites test lists the 2 new entries, old blue literal in leads CSS replaced by `--brand-500`. Added `tests/e2e/leads.e2e.mjs` (5 tests). model 801 / e2e 35 green. Not done: Mac walk-through; opening `#leads` directly as a URL hash hangs the e2e load (rail click works). Next: opportunity attachments, then 1.4.127.
- 2026-10-09 — Claude — Owner asked to put the icon from his design canvas on the app. Used the board marked 定稿 (B1 细缝, near-black base;
  the pink-base 反色版 beside it was not used). Redrew it from the canvas SVG into `assets/AppIcon.icns` (16–1024 px PNG entries,
  transparent corners) and kept the vector as `assets/AppIcon.svg`. `scripts/build.py` needs no change. Not done: Mac app not built
  or looked at (icon is under `assets/`, so the PR waits for 合并). Next: owner checks the Dock icon on the Mac build.
- 2026-10-09 — Claude — Owner wrote 合并 for PR #22 (rail pill, `main` 2475597). UI audit on the trial page built from the branch
  (pink and orange, three window sizes, no click-font check): 0 page errors, 0 native selects, 0 left-rail overlaps, within
  baseline. Web trial republished to the same Artifact (Version 2) from `main` 2475597; browser check of the built page: 7
  customers / 9 orders, save, stale save 409, reload keeps data, no errors. Not done: nothing open from this batch; owner still
  decides the motion pass, 客户类型 as a list column, a Mac build to download. Next: the waiting branches (leads first).
- 2026-10-09 — Claude — Owner merged #21 (web trial build tooling; `main` bb24626) and asked to change how the selected left-rail
  item looks. Showed four options as screenshots, owner picked the pill, then said the effect must include the text: the whole
  rail item (icon and label) is now a brand-colour pill with white icon and bold white label, no left bar (`src/skin-glass.css`,
  pink and orange skins; the xiaoman skin is unchanged). Item positions and heights do not change; checked at 1440×900,
  1280×720 and 1440×640. Overrides the 2026-10-08 "only main buttons stay dark" choice, recorded in `VALIDATION.md`.
  Tests 780 / 30. Web trial still shows the old look until this merges and the page is republished (D-012).
- 2026-10-09 — Claude — Owner wrote 合并 for PR #19 (小满 records) and #20 (A2); both merged (`main` 7e74221, then 302e6b2).
  #19 conflicted with `main` on this log; resolved by merging `main` into its branch. Its end-to-end job hung twice on
  `playwright install` (cancelled, rerun once, then green). The 20th Claude merge made the Mac build due; CI started it by
  itself on `main` 302e6b2 and it passed (build, integration test, package). The published web trial could not be read from the
  current account, so the owner asked for a new one: wrote `scripts/web-trial/data-shim.js` (browser-storage stand-in for
  `/api/data`, `/api/save`, import log, backup stubs, `window.LaiWebTrial`) and `scripts/web-trial/build.py` (whole page from
  the repo; `--publish` gives the fragment the Artifact tool wraps; the spreadsheet library's literal U+FFFD is written as
  `\uFFFD` because the tool refuses it). Tests: `tests/web-trial-shim.test.cjs` (6), `WebTrialBuild` in `test_release_tools.py`.
  Checked in a browser at 1440×900: opens with 7 customers / 9 orders, 12 customer-settings tabs, mail page, 测试数据 panel,
  save → stale save 409 → reload keeps data, no page errors. Published as a new private Artifact (see HANDOFF). Not done:
  `scripts/ui-audit` was started but had not finished when this was written; the page has no outer scroll container, so it is
  built for desktop width; file downloads do nothing in a published page. Next: owner opens the new page; decide whether to
  keep the old page's data (needs its HTML file).
- 2026-10-09 — Claude — 客户设置 A2 on `claude/customer-settings-2`, first batch run with the D-017 workflow: Opus wrote the spec and
  plan, Sonnet workers built it in parallel worktrees (W-A follow/deal/activity/followup model, W-B pool rules v2 —
  then W-C settings tabs, W-D customer flows — then W-E speed-up), Opus merged, fixed and an Opus reviewer checked it.
  Five new tabs (公海管理, 客户跟进规则, 客户成交规则, 动态设置, 写跟进设置); the old 公海规则 dialog is gone. Review fixes:
  a saved old pool rule is read back switched off (it never ran by itself before; now enabled rules run daily), new
  rules start today, mail addresses shared with pool customers are not auto-recorded, back-dated follow-ups do not
  move times back. Tests 774 / 30, UI audit passes. Not verified: auto mail recording against a real mailbox, Mac
  app. Remaining slowness outside A2: `buildCustomers` is O(customers × orders) and `enrich` sorts history per row.
- 2026-10-09 — Claude — Owner re-sent his three 小满 settings collection docs and asked to keep them in the repository as a
  reference for later work: `docs/xiaoman/` (the three docs, links to the evidence files that were not sent turned into
  plain codes, plus a README with usage rules and a 小满 → 来财 comparison table). `.gitignore` and `AGENTS.md` changed,
  so it waits for 合并. A2 (客户设置 second half) starts next from these docs.
- 2026-10-09 — Claude — Owner said 合并 on PR #15 (D-017: Opus coordinates, Sonnet subagents in worktrees): merged
  (2de28d3). Mac build not due (cadence check after the merge). From now on sessions on this repo start with Opus 5.5
  high and the `worker` / `reviewer` agents. Next: batch A2, once the owner re-sends the three 小满 settings docs.
- 2026-10-09 — Claude — Owner asked for a new way of working (D-017): Opus 5.5 at high effort coordinates; subagents
  default to Sonnet 5.5 at medium effort (`CLAUDE_CODE_SUBAGENT_MODEL` in `.claude/settings.json`, `worker` and
  `reviewer` agents in `.claude/agents/`). Opus writes the spec, plan and every subagent prompt, picks each subagent's
  model/effort, runs slices in parallel worktrees (`worktree.baseRef: head`) and merges them itself. Checked in this
  session: a Sonnet worktree agent committed on `worktree-agent-<id>` and the coordinator merged it cleanly
  (throwaway, removed). The new settings load from the next session on. Touches `CLAUDE.md` → waits for 合并.
- 2026-10-09 — Claude — After PR #14 (客户设置 A1, 6941054; CI green including the Mac build, since it changed
  `scripts/build.py`): web trial republished as Version 45 from 6941054 and walked in Chromium at 1440×900: all
  seven tabs open, a new stage survives a reload, no console errors. `rebuild.py` stops on the three new `src/` files, so the three blocks were
  placed by hand in `template.html` order (settings CSS after customer-suggestions.css, settings model before model.js,
  settings UI before customer-import.js), with a local-only base commit = 91906aa + those files as `--old-ref`; the
  script then swapped the other nine files. Teaching `rebuild.py` to place new files itself would remove this step.
  Noticed: the default stage "待付尾款." has a stray full stop (old, also in `customer-detail-ui.js`). Next: batch A2.
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
