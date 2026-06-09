# guardrails/ — the Guardrails faculty (enforced, not advisory)

Declarative rules in `rules.json`, evaluated on every tool call by the mns
PreToolUse gate (installed by `mns enable`). Severity wins: deny > ask > allow;
no match → the host's normal permission flow. The engine FAILS OPEN — a
guardrail bug can block nothing — and matched decisions are logged for the trace.

Rule shape: `{ id, action: deny|ask|allow, tool: "Bash"|"*", pattern: <regex
over the tool input>, reason }`. Edit, commit, done — rules are definitions,
versioned in git like everything else.
