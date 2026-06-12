# Security policy

Report vulnerabilities via GitHub's private vulnerability reporting (Security tab → "Report a vulnerability"). Please don't open public issues for exploitable problems.

Relevant by design: zuzuu installs agent hooks (always fail-open, exit 0), reads host transcripts read-only, and writes only inside the project's `.zuzuu/`. No raw tool input/output is persisted on traces (byte sizes only); no data leaves the machine.
