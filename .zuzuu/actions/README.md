# actions/ — procedural faculty (how to DO things)

Named, reusable procedures/skills for this project (scripts, runbooks, tool recipes).
- **Who writes:** the human; later, zuzuu proposes crystallized actions mined from traces (human-approved).
- **Contract:** one action per file; state what it does, inputs, and how to invoke it.
- **Propose a reusable action**: `zuzuu act propose <slug>` scaffolds into `actions/inbox/` for review. A human approves via `zuzuu review` (or `zuzuu act approve <slug>`). Never write active actions directly from an agent.
