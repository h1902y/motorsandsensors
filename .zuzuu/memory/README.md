# memory/ — episodic faculty (what HAPPENED)

Curated recollections of past sessions, distilled from the observability traces (`.zuzuu/.traces/`).
- **Who writes:** zuzuu (distillation — *not built yet*), human (curation). Raw traces stay in traces/ — this is the *curated* layer.
- **Where:** one Markdown file per entry under `entries/`, named `<id>.md`.

## Record schema (Markdown + YAML frontmatter)
```markdown
---
id: mem-2026-06-11-flaky-ci-retry      # mem-<YYYY-MM-DD>-<slug>, stable
date: 2026-06-11                        # ISO date the episode occurred
title: Flaky CI fixed by pinning node 22
provenance:                            # links back to observability
  sessions: [ses_abc123]               # ids that exist in .zuzuu/sessions.json
  hosts: [claude-code]
tags: [ci, flaky-test]                 # optional
status: curated                        # curated (human) | proposed (reserved — future distiller)
---
## Attempted
What was tried.
## Resulted
What happened (outcome / error / fix).
## Remember next time
The durable lesson.
```
`status: proposed` and the distiller→review pipeline are **reserved** (not built this pass).
