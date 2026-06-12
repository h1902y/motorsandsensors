# .zuzuu/ — your agent's home (hidden, like .git — yours to read & version)

This directory is your agent's evolving brain. Five **faculties** grow from how you
actually work — and **nothing changes without your approval**. It's dot-prefixed to
stay out of your way; everything inside is plain text, versioned in git, and
surfaced by `zuzuu status` / `zuzuu explain` / `zuzuu digest`.

## The five faculties
- **knowledge/** — what's TRUE (facts about this project)
- **memory/** — what HAPPENED (curated episodes from past sessions)
- **actions/** — how to DO things (runbooks the agent can call)
- **instructions/** — who to BE (steering / project conventions)
- **guardrails/** — what NOT to do (enforced rules, checked on every tool call)

## How things graduate (you're in the loop)
    a session runs  →  zuzuu mines candidates  →  inbox/  →  proposals/
                                                              │  you decide
                                                    zuzuu review  (y / n / edit)
                                                              ▼
                                          approved → the faculty + a new *generation*
A **generation** is a pinned checkpoint of every faculty. Approving proposals mints
one; `zuzuu generation rollback <id>` restores any earlier checkpoint.

## Get in the loop
- `zuzuu inbox`            — what's waiting for your approval
- `zuzuu review`          — approve / reject, one at a time
- `zuzuu generation list` — your checkpoints (· = active)
- `zuzuu explain`         — this model, any time

## What to ignore
`.traces/`, `.live/`, and `knowledge/.index.db` are machine internals (git-ignored).
Everything else here is yours to read, edit, and version in git.
