@AGENTS.md

## Claude only (Codex: ignore this section)

- The Mac app was removed (owner decision 2026-10-17, D-026): web version only. There is no Mac build, Swift code or Mac CI job.

## How Claude works: coordinator + subagents + Fable on call (D-027, replaces D-017)

Opus 5.5 at high effort is the main session: it plans, delegates, reviews and verifies. Subagents run on Opus 5.5 at
medium effort (`.claude/agents/`): `explorer` reads code, `worker` edits and tests in its own worktree, `researcher`
looks up docs, `reviewer` checks a diff. Fable 5.1 is on call as the `advisor` agent (high effort, read-only); the
coordinator consults it at three moments: before picking a plan, when an error repeats, and before calling a task
done. Plan on high, delegate on medium, keep Fable on call.

Fable 5.1 at medium effort is the `specialist` agent (D-032): it edits and tests in its own worktree like `worker`.
Give it a slice instead of a `worker` when (a) the slice is complex: hard debugging with an unclear cause, large
edits in `src/app.js`, data safety (`backend/`, storage, revisions, migrations), or a change across several modules;
or (b) a second pass is needed: a worker's slice failed review or its tests twice, or the fix needs rework rather
than a small patch. Its prompt names the branch/SHA of the first attempt and the findings to fix.

The owner (2026-10-17): do not ask him questions; when unsure, consult the `advisor` and decide. Still ask him only for
what AGENTS.md lists under "Ask the owner first" (new dependencies, schema/data-directory changes, irreversible
real-world actions, releases) and for things only he can do (his accounts, GitHub settings).

1. **Spec and plan first, in the conversation.** Before delegating, write the final spec (goal, behaviour, files,
   tests, out of scope) and a plan split into slices that touch different files. Commit it if workers need files
   from it (worktrees start from the committed `HEAD`, not uncommitted changes).
2. **Write every subagent prompt yourself, in detail:** the spec part it needs, the files it owns, files it must not
   touch, the checks to run and what to report. Never hand over a one-line prompt.
3. **Pick the agent and effort per subagent and say why.** Default is `opus` + `medium` for every agent type.
   For hard debugging with an unclear cause, large edits in `src/app.js`, data safety (`backend/`, storage,
   revisions, migrations) or a second pass, use `specialist` (Fable, medium) instead of `worker`. Consult the `advisor` (Fable, high) before a plan, when an error
   repeats, and before "done"; the coordinator still decides.
4. **Run independent slices in parallel** with the `worker` agent (own git worktree each; it commits there and
   reports branch + SHA). Read-only checks use `reviewer`; code questions use `explorer`; docs and reference
   lookups use `researcher`. If the main session was interrupted, check the background agents first and restart
   any that were stopped with it, from their saved work.
5. **Merge and fix yourself:** `git merge --no-ff` each worker branch into the task branch, resolve conflicts, run
   `npm run test:model` and `npm run test:e2e`, review the combined diff, fix what is wrong, then make the final
   commit and push. The Agent result names the branch (`worktree-agent-<id>`) and path; after merging, remove both
   (`git worktree remove --force <path>`, `git branch -D <branch>`). Worker branches stay local; one task is still
   one branch and one PR.
6. Reviews, refactors and migrations can be delegated to a `reviewer`, but the coordinator writes its checklist and
   decides on every finding. Small one-file fixes the coordinator may do directly.
