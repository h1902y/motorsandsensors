# agent/ — your coding agent's home, in the open

This directory is your agent's evolving brain. Five **faculties** grow from how you
actually work — and **nothing changes without your approval**.

## The five faculties
- **knowledge/** — what's TRUE (facts about this project)
- **memory/** — what HAPPENED (curated episodes from past sessions)
- **actions/** — how to DO things (runbooks the agent can call)
- **instructions/** — who to BE (steering / project conventions)
- **guardrails/** — what NOT to do (enforced rules, checked on every tool call)

## How things graduate (you're in the loop)
    a session runs  →  mns mines candidates  →  inbox/  →  proposals/
                                                              │  you decide
                                                    mns review  (y / n / edit)
                                                              ▼
                                          approved → the faculty + a new *generation*
A **generation** is a pinned checkpoint of every faculty. Approving proposals mints
one; `mns generation rollback <id>` restores any earlier checkpoint.

## Get in the loop
- `mns inbox`            — what's waiting for your approval
- `mns review`          — approve / reject, one at a time
- `mns generation list` — your checkpoints (· = active)
- `mns explain`         — this model, any time

## What to ignore
`.traces/`, `.live/`, and `knowledge/.index.db` are machine internals (git-ignored).
Everything else here is yours to read, edit, and version in git.
