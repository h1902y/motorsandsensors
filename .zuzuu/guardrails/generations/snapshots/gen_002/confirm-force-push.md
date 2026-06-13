---
id: confirm-force-push
module: guardrails
kind: rule
title: force-push rewrites shared history
status: active
created_at: "2026-06-12T18:54:18Z"
payload:
  action: ask
  tool: Bash
  pattern: "git\\b.*\\bpush\\b.*--force"
  reason: force-push rewrites shared history
---
