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
