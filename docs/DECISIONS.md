# Decision records

Decisions the owner (Kris) has made. Ask the owner before changing one. When a decision changes, set the old
entry's status to "Superseded by D-xxx" and add a new entry — do not delete history.
Format follows lightweight architecture decision records (ADR): number, status, context, decision, consequences.
Statuses: Accepted / Superseded / Deprecated.

Business-rule details chosen while building a feature (field lists, defaults, how a number is counted) are not
listed here; they are in `VALIDATION.md`, and the owner can change them afterwards (D-003).

| # | Decision | Status |
| --- | --- | --- |
| D-001 | A local macOS app; data stays on the Mac | Partly superseded by D-026 (the macOS app part) |
| D-002 | OKKI CRM (小满) is the reference product | Accepted |
| D-003 | Build each module deeply in one go; no placeholder entries | Accepted |
| D-004 | Only irreversible real-world actions need the owner's go-ahead | Accepted |
| D-005 | Synthetic data only; formal import stays disabled until complete | Accepted |
| D-006 | No 回款 (payment collection) and no 海关数据 (customs data) | Accepted |
| D-007 | Mail: Zoho Mail with an app-specific password | Accepted |
| D-008 | Colour themes: pink by default; orange and 小满 blue as options | Accepted (default changed 2026-10-16); default superseded by D-033 |
| D-009 | Left rail and entries | Accepted; its Leads entry superseded by D-030 |
| D-010 | Look and feel | Accepted |
| D-011 | Prefer mature open-source code over hand-written code | Accepted |
| D-012 | Publish the web trial after every change; Claude tests it itself | Accepted |
| D-013 | Branch from `main`, merge back after acceptance | Superseded by D-014 |
| D-014 | One PR per change; small ones merge themselves, big ones wait for 合并 | Accepted |
| D-015 | Moderate verification for small features | Accepted |
| D-016 | Mac build cadence: Claude every 10th merge, others every PR | Superseded by D-026 |
| D-017 | Claude: Opus coordinates, Sonnet subagents do the work in parallel worktrees | Superseded by D-027 |
| D-019 | Desktop builds (Mac, Windows) paused; web version only for now | Superseded by D-026 |
| D-022 | Company details live in one place; 本人 scope also limits 团队数据; tasks belong to a person | Accepted; the tasks part superseded by D-031 |
| D-023 | 沟通 module uses WhatsApp | Accepted |
| D-024 | Multi-user later runs on Cloudflare; not set up now | Accepted |
| D-025 | Complex tasks get their own audit before building | Accepted |
| D-026 | Mac app removed; web only | Accepted |
| D-027 | Claude agent tree: Opus 5.5 high coordinates, Opus 5.5 medium subagents, Fable 5.1 on call as advisor | Accepted |
| D-028 | UI direction: one component kit with shadcn/ui-style rules (tidy, consistent) in the 科技蓝 colours | Accepted |
| D-029 | 小满 style removed; its place taken by 科技蓝 (themes: pink default, orange, 科技蓝) | Accepted |
| D-030 | 线索 (leads) removed, code deleted; stored lead data kept | Accepted |
| D-031 | 协同 removed (calendar, 任务设置, tasks), code deleted; stored task data kept | Accepted |
| D-032 | Fable 5.1 `specialist` (medium effort, edits) for complex slices and second passes; `researcher` agent file added | Accepted |
| D-033 | Light Linear look is the default: 科技蓝 recoloured (white panels, white rail, neutral greys, cobalt accent); pink and orange optional | Accepted |

---

### D-001 A local macOS app (2026-09)
- Status: the macOS app part is superseded by D-026 (2026-10-17); the local backend and SQLite storage stay.
- Decision: 来财Lai is a standalone macOS app (macOS 13.5+). A Swift shell runs a local Node server bound to
  127.0.0.1 with SQLite in `~/Library/Application Support/LaiCRM`. The owner installs builds on his own Mac to
  accept them.
- Consequences: "我的客户／团队客户" and owner names are not real accounts or permissions yet. Company-wide sharing
  (accounts, roles, central server) is a separate, undecided project — see the task board.

### D-002 Reference product (2026-09)
- Decision: follow OKKI CRM (小满) for features, layout and behaviour, including the mail module's 邮件／客户／下属
  tabs and the left-rail flyouts with a 常用 (favorites) sub-nav.

### D-003 Build each module deeply (2026-10-06, replaces "confirm first / defer")
- Decision: each module is built far enough to do real work in one go. Do not stop at a skeleton, do not leave
  "功能入口已保留" placeholder entries, do not cut a feature into small steps that are useless on their own, do not
  default to the smallest option. Do not stop to ask about new business fields or rules: decide from the
  reference product and common practice, write the choice in `VALIDATION.md`, tell the owner afterwards.
  Common-sense calls (names differing only in case, spaces or full/half-width are the same person) are made, not asked.

### D-004 Irreversible actions (2026-10-06)
- Decision: only actions that cannot be taken back need the owner's go-ahead at the time: sending mail or messages
  from a real account, paying, changing or deleting his real business data. Building these features does not.
- Credentials (mail passwords and similar) live only on the owner's Mac — never in code, docs, tests or commits.

### D-005 Data safety (2026-09, kept 2026-10-06)
- Decision: test only with synthetic data (`docs/samples/`, test fixtures); never upload business data; never
  install, replace or launch the owner's installed app; the formal import entry stays disabled until preview,
  commit, rollback and logging are complete.

### D-006 Modules ruled out (2026-10-07)
- Context: on 2026-10-06 the earlier deferral of 回款, 海关数据 and external communication was lifted.
- Decision: the owner then decided not to build 回款 (payment collection) or 海关数据 (customs data). Do not
  recommend them as next steps. External communication (mail) stays in scope.

### D-007 Mail (2026-10-06)
- Decision: Zoho Mail on zoho.com.cn, bound with an app-specific password over IMAP/SMTP; the credential is stored
  in the local database. The mail module follows the reference product (D-002).

### D-008 Colour themes (2026-10-08)
- Decision: the UI is a colour template switchable in 设置. Default is rose pink; warm orange and the 小满 style
  (the original blue look) are optional templates. No green.
- 2026-10-16: the owner confirmed pink as the default (it had been the app's default since task 17; the decision text
  still said 小满 blue).

### D-009 Left rail and entries (2026-10-08)
- Decision: removed the 客服 (customer service) button and AI批量质检 (AI batch quality check). The rail entry
  "OKKI Leads" is called "Leads" and has a 设置 option. 设置 and 企业管理 are separate rail entries; 设置 holds 设置 and
  设置中心 (one place that collects everything configurable). The workbench has no second-level nav column.
- Favorites (常用): nothing is a favorite by default; a heart appears on hover and marks an entry as 常用; every real
  menu entry can be a favorite.

### D-010 Look and feel (2026-10-08)
- Decision: clean but not stark (简洁，但不特别简约). All dropdowns share one look, and the text does not change font
  when a dropdown opens.

### D-011 Mature code first (2026-10)
- Decision: before writing a feature by hand, check whether a well-maintained open-source library or existing
  implementation already does it, and prefer it (e.g. mail uses imapflow, nodemailer, postal-mime, Squire,
  DOMPurify). Adding one still needs the owner's OK (AGENTS.md, "Ask the owner first").

### D-012 Web trial (2026-10)
- Decision: after every change to the app, publish the web trial page. Claude tests the published page itself in
  its own browser (clicks and checks), not in the owner's browser. Rules for rebuilding: `scripts/web-trial/README.md`.

### D-013 Branch rule (2026-10-07) — Superseded by D-014
- Decision: every session branches from the latest `main`; after the owner accepts the work it is merged back into
  `main`; sessions no longer share `claude/web-trial-combined`.

### D-014 Pull requests and merge policy (2026-10-08)
- Context: several sessions worked in parallel and left work unmerged on long-lived branches. The repository is
  private on a free plan, so GitHub branch protection and native auto-merge are not available; the policy lives
  in CI instead. The owner does not use the GitHub website.
- Decision: still branch from `main`, but every change goes through its own PR (no batching). CI classifies it
  (`scripts/classify-pr.mjs`): small changes merge themselves when every check is green; big ones get the
  `needs-owner` label and wait until the owner writes 合并. Definitions: `AGENTS.md`, "Merging". Merge commits,
  not squash.
- The classification runs from `main`'s copy of the workflow and scripts (`merge-policy.yml`, `workflow_run`), so
  a PR cannot judge itself with edited rules; merged branches are kept (D-013 rule 5) (2026-10-09).
- Limit: at most 500 changed lines in `src/` for a small PR (owner raised it from 350 on 2026-10-09).
- Consequences: the only cost is GitHub Actions minutes. The Mac build runs on macOS runners, which a private
  repository pays for at 10× the Linux rate; how often it runs is D-016.

### D-015 Moderate verification for small features (2026-10-07)
- Decision: small features should be done quickly, with moderate verification — the automated tests plus a short
  walk-through — not a heavy review. Bigger modules still get an independent review.

### D-016 Mac build cadence (2026-10-09)
- Status: superseded by D-026; the Mac build no longer exists.
- Context: macOS minutes cost 10× on a private repository.
- Decision: for Claude, the Mac build runs once every 10 updates: Claude PRs (`claude/*`) skip it, and `main` is
  built after every 10th merged Claude PR. Exception: a Claude PR that changes `native/` or `scripts/build.py`
  still builds, because Swift only compiles on a Mac. This applies to Claude only; Codex and people keep the Mac
  build on every PR that changes the app. The instruction for Claude is in `CLAUDE.md` (Codex does not read it).
- Consequences: up to nine Claude merges can reach `main` before a Mac build checks them. The owner can ask for a
  build at any time (manual CI run on `main`, which also produces a downloadable app).

### D-017 Claude works as coordinator + subagents (2026-10-09)
- Context: the owner wants Opus to plan and judge, and cheaper Sonnet subagents to do most of the work in parallel.
- Decision: Opus 5.5 at high effort coordinates; subagents run on Sonnet 5.5 at medium effort by default. Opus
  writes the final spec and plan in the conversation, writes each subagent's prompt in detail, picks each subagent's
  model and effort (default Sonnet medium; Sonnet high or Opus medium where the work needs it), runs independent
  slices in parallel git worktrees, then merges them, fixes what is wrong and makes the final commit. Details and
  the selection rules: `CLAUDE.md`; settings: `.claude/settings.json`, `.claude/agents/`. Claude only; Codex is not
  affected.
- Consequences: the session model and effort come from the committed settings, so a session started with another
  model in the app may still need `/model` or `/effort`. Worker branches stay local; the PR rule (D-014) is unchanged.

### D-018 小满 settings ruled out: 工作流, 审批流, 营销设置 (2026-10-09)
- Context: while replicating the owner's 小满 settings, the remaining pages were reviewed.
- Decision: the owner decided not to build 工作流 (workflows), 审批流 (approval flows) or 营销设置 (marketing settings).
  Do not recommend them as next steps. They are marked 排除 in `docs/xiaoman/README.md`.

### D-019 Desktop builds paused, web version only (2026-10-10)
- Status: superseded by D-026; the paused code was deleted.
- Context: the owner wants to focus on the web version first. Only a Mac build existed in CI; there is no Windows build.
- Decision: all automatic desktop builds are stopped. CI's `mac build + integration` job and the every-10th-merge
  build on `main` do not run (`PAUSED = true` in `scripts/mac-cadence.mjs`); `CLAUDE.md` tells Claude not to start or
  wait for Mac builds. A manual CI run still builds the Mac app if the owner asks. No desktop code is deleted
  (`native/`, `scripts/build.py`, the integration test stay). Features are verified in the browser and on the web trial.
- Resuming: set `PAUSED` to `false`; D-016 then applies again. Mac-only risks (Swift code, packaging) go unchecked
  while paused, so run one Mac build before the first desktop release.

### D-020 Saves send only what changed (2026-10-09)
- Context: with many customers every edit re-sent the whole dataset (11 MB at 10,000 customers). The owner chose
  "只传改动 + 分页" as the first step toward moving customers to a server later.
- Decision: the page keeps a snapshot of the saved data and sends only the changed customers, orders and settings to
  `POST /api/save-changes`; the backend applies them in one transaction with the same `baseRevision` check, verifies
  the table counts and the order positions, and rolls everything back if they do not match (the page then falls back
  to the full `POST /api/save`). The SQLite schema and the data directory are unchanged. Reading is still the whole
  dataset (`GET /api/data`); true server-side paging needs search, sort, segments and counts to move to the server and
  belongs to the move to a server.

### D-021 One interface font: Inter + MiSans, embedded in the page (2026-10-15)
- Context: the owner asked to unify every font: MiSans for Chinese, a recommended font for English.
- Decision: `--font-ui` is Inter (Latin, digits) then MiSans VF (Chinese), then system fonts. Both are vendored in
  `vendor/fonts/` and inlined into the page as data URIs at build time, so the Mac app and the web trial look the same
  and need no network. Styles use `var(--font-ui)` or `inherit`, never their own stack (test: `tests/ui-fonts.test.cjs`);
  the 来财 wordmark keeps its rounded font. MiSans's license requires naming it in the software (关于来财Lai).

### D-022 Company details, team data scope, personal tasks (2026-10-16)
- Company name, address, phone and bank are kept in one place; documents (报价单, PI, 销售订单, 发货通知) read them
  from there. The separate 公司名称 field in 设置 no longer stands on its own.
- An account with the 本人 scope sees only its own figures in 团队数据 (rankings, goals, drill-downs).
- Calendar tasks belong to the person who owns them; a 本人 account sees only its own tasks.

### D-023 沟通 module: WhatsApp (2026-10-16)
- The 沟通 module is built for WhatsApp. Task 9 is unblocked; the 沟通 entry stops being a placeholder once it is built.
- Until there is a server (D-024) the app cannot receive WhatsApp messages by itself; what can be built without one is
  decided in the WhatsApp audit (D-025). Sending real messages from the owner's account needs his go-ahead (D-004).

### D-024 Multi-user on Cloudflare, later (2026-10-16)
- When several people use 来财, it runs in the cloud on Cloudflare. Not set up now; the app stays local and web-only
  (D-019). Roles and accounts stay a local preview until then.

### D-025 Complex tasks get their own audit (2026-10-16)
- Before building a complex task (a new module, a cross-module change, anything touching data storage or permissions),
  Claude runs a separate read-only audit first: what exists, what the reference product does, risks, a proposed spec
  and slices. Building starts from that audit. Small fixes skip it.

### D-026 Mac app removed; web only (2026-10-17)
- Context: the owner, on 2026-10-17: "mac 版验收去掉这个任务,这个无限期暂停,mac 代码可以删除" (drop the Mac acceptance
  task; the Mac version is paused indefinitely; the Mac code may be deleted).
- Decision: `native/` (the Swift shell), the Mac build (the `.app` part of `scripts/build.py`), the Mac CI job and its
  cadence logic (`scripts/mac-cadence.mjs`), the integration test, the app icon assets and the acceptance scripts that
  only ran against the built Mac app are removed. The product is the web version. The local Node backend (`backend/`,
  SQLite, mail) stays: it is the data layer and the browser end-to-end tests run on it. `assemble_html()` in
  `scripts/build.py` stays, because the web trial and the tests build the page with it.
- Supersedes: the macOS-app part of D-001, D-016 and D-019. The `mac` flag in `docs/features.json` is no longer used.
- Consequences: no desktop build or Mac acceptance is planned. If a desktop app is wanted again, it is a new project
  (the old `native/` stays in the commit history).

### D-027 Claude agent tree: Opus coordinates, Opus subagents, Fable on call (2026-10-17)
- Context: the owner handed over a diagram ("Plan on high. Delegate on medium. Keep Fable on call.") and said 按照这个执行.
- Decision: the main session is Opus 5.5 at high effort; it plans, delegates, reviews and verifies. Subagents are
  Opus 5.5 at medium effort: `explorer` (read code), `worker` (edits and tests, own worktree), `researcher` (look up
  docs), `reviewer` (check a diff). Fable 5.1 is the `advisor` agent (high effort, read-only), consulted before
  picking a plan, when an error repeats, and before calling a task done. Replaces D-017's Sonnet default.
- Consequences: `.claude/agents/*.md` carry the models; `.claude/settings.json` keeps the main session on Opus high.
  A session switched to another model with `/model` should be switched back to `claude-opus-5-5` to match.

### D-028 UI direction: shadcn-style rules in 科技蓝 colours (2026-10-17)
- Context: an advisor review found the pages inconsistent (100 button styles, 8 table headers, 6 pagers, 4 tab styles,
  3 dialog designs) and pink used as paint rather than signal. The owner saw a shadcn/ui-style preview and the 科技蓝
  workbench preview and chose: "整齐规则配上科技蓝的颜色" (the tidy rules, with the 科技蓝 colours).
- Decision: build one component kit (buttons, inputs, selects, tabs, table + pager, dialog/drawer shell with an error
  slot, empty state, toast, page header) following shadcn/ui's rules: one neutral scale, 1px borders, a small radius
  scale, faint shadows, minimum 12px text, one primary colour used only for meaning (primary action, active item,
  links, progress). Its reference colours are the 科技蓝 palette (navy rail, cobalt primary, cool grey). No shadcn/React
  code or npm dependency: the look is rebuilt in the app's own CSS and tokens. Pages move onto the kit one per PR.
- Consequences: the kit works through theme tokens, so pink, orange and 小满 keep working; the default theme stays pink
  (D-008) until the owner switches it. New markup must use kit classes; a token ratchet test stops new literal colours,
  font sizes and radii.

### D-029 小满 style removed, replaced by 科技蓝 (2026-10-17)
- Context: the 小满 theme was not just colours but a separate older layout (`data-skin="classic"`), so pages such as
  orders and opportunities carried two versions. Asked whether 小满 should keep only its colours, the owner answered:
  "去掉小满风格,改成科技蓝" (remove the 小满 style, use 科技蓝 instead).
- Decision: the 小满 theme and the classic skin are removed. The themes are pink (default, D-008), orange and 科技蓝,
  all on one layout (the D-028 kit). An account whose saved theme is 小满 is shown 科技蓝; the saved value is
  rewritten to 科技蓝 the next time settings are saved. No data other than that setting is touched.
- Supersedes: the 小满 option in D-008 (pink stays the default).

### D-030 线索 (leads) removed (2026-10-17)
- Context: the owner: "leads 线索功能去掉,代码删除" (remove the leads feature, delete the code).
- Decision: the 线索 module goes: the 线索 and "Leads" rail entries, 线索列表, 线索回收站, 线索设置, lead custom fields,
  转为客户, the 新线索与已有客户 判重 rule, the 来源线索 field on opportunities, lead matches in WhatsApp, lead export,
  lead permissions and the 线索 feature switch. The code and its tests are deleted.
- Data: nothing stored is deleted. `laiLeads`, `laiSettings.leadSettings`, lead custom field definitions, `leadDedupe`,
  opportunity `leadId` and customer fields such as 关联线索 stay in the data untouched (saves keep keys the code no
  longer knows), so the feature can be brought back from git with the data intact. Customer history lines
  「由线索转入」 stay as ordinary history.
- Supersedes: the "Leads" rail entry in D-009.

### D-031 协同 removed: calendar, 任务设置 and tasks (2026-10-17)
- Context: the owner: "协同删除 代码删除". 协同 held 日历与待办 and 任务设置 (auto task rules). Keeping tasks without the
  calendar would leave dead ends (全部待办 and 查看 buttons to a missing page, tasks that cannot be deleted, future tasks
  nowhere to be seen), so tasks go with it (explorer report, coordinator decision; the owner can reverse it).
- Decision: removed: the 协同 rail entry, the calendar page, 任务设置 and the daily auto-task run, the task drawer, task
  rows and 添加任务 on the 工作台, 团队数据 → 任务完成 and the 任务完成率 / tasksDone target, the 去分配 hint, and the
  customer detail 计划日程 → 查看 link (添加 for the next follow-up date stays). Code and tests deleted.
- Data: nothing stored is deleted. `laiTasks`, `laiSettings.taskRules` and saved targets on tasksDone stay untouched.
  Customer rename and merge keep renaming `laiTasks[].customer` so the kept data stays consistent.
- Supersedes: the "tasks belong to a person" point of D-022.

### D-032 Fable `specialist` for complex work and second passes (2026-10-17)
- Context: the owner asked for one more Fable 5.1 role, "专门处理复杂任务或者进行二次修改" (for complex tasks or second
  rounds of changes), next to the read-only `advisor`.
- Decision: `.claude/agents/specialist.md`, Fable 5.1 at medium effort, edits and tests in its own worktree like
  `worker`. The coordinator sends it (a) complex slices: hard debugging with an unclear cause, large edits in
  `src/app.js`, data safety, changes across several modules; (b) second passes: a worker's slice that failed review
  or its tests twice, or needs rework rather than a small patch. The `advisor` stays read-only and on call.
- Also: the `researcher` agent named in D-027 had no file; `.claude/agents/researcher.md` now exists (Opus, medium,
  read-only, web lookups).
- Refines: D-027 (raising a subagent to high effort is replaced by handing the slice to `specialist`).

### D-033 Light Linear look becomes the default (2026-10-17)
- Context: the owner liked the light Linear-style workbench preview (https://claude.ai/artifact/EcFzzjH1E4vV5QuJsk8vTr)
  and, asked in thread #05 whether it should become the default look with pink and orange kept as options, answered
  "是的" (yes).
- Decision: no new theme id. The 科技蓝 theme (`tech`) is recoloured to the light look: page `#fafafa`, white panels
  with 1px neutral borders, a white rail with dark grey icons and a light grey current item with a cobalt icon,
  neutral (zinc) greys, cobalt `#2f5bff` as the one accent. 科技蓝 is the default (`DEFAULT_THEME` in `src/app.js`, and
  the `:root,` fallback block in `src/ui-tokens.css`). The layout (top bar, icon rail, sub-nav, cards) is unchanged.
- Data: a saved pink or orange stays as it is; accounts that never chose a colour and the web trial get the new
  default; accounts that chose 科技蓝 (or 小满, shown as 科技蓝 per D-029) see the light rail. Nothing stored is rewritten.
- Steps: S-A colours and rail, S-B default (PR #35); S-C taste tweaks (radius, selected states) after the
  owner looks at the trial. All before the old-CSS merge (S4).
- Supersedes: the default in D-008 (pink); the navy rail in D-028's reference palette.

