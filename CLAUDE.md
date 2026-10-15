@AGENTS.md

## Claude only (Codex: ignore this section)

- Desktop builds (Mac and Windows) are PAUSED (D-019, 2026-10-10): only the web version is built for now. Do not
  start Mac builds, do not run `mac-cadence.mjs after-merge` for a build, and do not wait for one. CI skips the Mac job
  by itself (`PAUSED` in `scripts/mac-cadence.mjs`). The owner can still ask for a Mac build: start a manual run
  (`gh api -X POST repos/Kr1xxxx/lai-WEB/actions/workflows/ci.yml/dispatches -f ref=main`). `native/` and the build
  scripts stay in the repo untouched. To resume, set `PAUSED` to false (D-016's every-10th-merge rule then applies again).

## How Claude works: coordinator + subagents (D-017)

Opus 5.5 at high effort is the coordinator; subagents default to Sonnet 5.5 at medium effort (`.claude/settings.json`,
`.claude/agents/`). The coordinator plans, delegates, reviews and merges; subagents do the work.

1. **Spec and plan first, in the conversation.** Before delegating, write the final spec (goal, behaviour, files,
   tests, out of scope) and a plan split into slices that touch different files. Commit it if workers need files
   from it (worktrees start from the committed `HEAD`, not uncommitted changes).
2. **Write every subagent prompt yourself, in detail:** the spec part it needs, the files it owns, files it must not
   touch, the checks to run and what to report. Never hand over a one-line prompt.
3. **Pick the configuration per subagent and say which one and why.** Pass `model` and `effort` on every call:
   - Default `sonnet` + `medium`: clear, well-specified code, tests, docs, mechanical refactors, searches.
   - `sonnet` + `high`: hard logic or debugging with an unclear cause, large edits in `src/app.js`, e2e tests.
   - `opus` + `medium`: data safety (`backend/`, storage, revisions, migrations), security, cross-module design,
     the final review of a risky diff.
4. **Run independent slices in parallel** with the `worker` agent (own git worktree each; it commits there and
   reports branch + SHA). Read-only checks use the `reviewer` agent.
5. **Merge and fix yourself:** `git merge --no-ff` each worker branch into the task branch, resolve conflicts, run
   `npm run test:model` and `npm run test:e2e`, review the combined diff, fix what is wrong, then make the final
   commit and push. The Agent result names the branch (`worktree-agent-<id>`) and path; after merging, remove both
   (`git worktree remove --force <path>`, `git branch -D <branch>`). Worker branches stay local; one task is still
   one branch and one PR.
6. Reviews, refactors and migrations can be delegated to a `reviewer`, but the coordinator writes its checklist and
   decides on every finding. Small one-file fixes the coordinator may do directly.
