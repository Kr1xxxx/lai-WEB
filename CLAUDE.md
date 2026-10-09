@AGENTS.md

## Claude only (Codex: ignore this section)

- Mac build every 10 updates (D-016). Your PRs (`claude/*`) skip the Mac build unless they change `native/` or
  `scripts/build.py`; CI builds `main` after every 10th merged Claude PR (counted by `scripts/mac-cadence.mjs`).
- After any merge into `main` (yours after the owner's 合并, or CI's automatic one), run
  `MAIN_REF=origin/main node scripts/mac-cadence.mjs after-merge`. If it says due, make sure the Mac build on
  `main` ran (automatic merges start it; for merges you made, start it yourself:
  `gh api -X POST repos/Kr1xxxx/lai-app/actions/workflows/ci.yml/dispatches -f ref=main`), wait for it and report
  the result. If it fails, fixing it comes before anything else.
- When the owner asks for a Mac build or a downloadable app, start the same manual run and send him the artifact name.

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
