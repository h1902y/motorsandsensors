---
id: no-secret-reads
module: guardrails
kind: rule
title: secret material should not enter the context
status: active
created_at: "2026-06-12T18:54:18Z"
payload:
  action: deny
  tool: *
  pattern: "\\.env(\\.|\\b)|id_rsa|\\.pem\\b"
  reason: secret material should not enter the context
---
