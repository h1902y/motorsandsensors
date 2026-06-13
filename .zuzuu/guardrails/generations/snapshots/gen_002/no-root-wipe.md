---
id: no-root-wipe
module: guardrails
kind: rule
title: destructive delete at filesystem root
status: active
created_at: "2026-06-12T18:54:18Z"
payload:
  action: deny
  tool: Bash
  pattern: "rm\\s+-[a-z]*r[a-z]*\\s+/(\\s|$)"
  reason: destructive delete at filesystem root
---
