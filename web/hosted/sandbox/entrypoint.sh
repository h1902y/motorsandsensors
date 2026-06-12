#!/usr/bin/env bash
# Sandbox VM entrypoint: seed a friendly empty workspace, then run the daemon
# in hosted mode. WEBCODE_TOKEN / WEBCODE_PUBLIC_HOST are injected per-session
# by the broker (Fly Machine env).
set -euo pipefail

WORKSPACE="${WEBCODE_ROOT:-/home/sandbox/workspace}"
mkdir -p "$WORKSPACE"
if [ -z "$(ls -A "$WORKSPACE" 2>/dev/null)" ]; then
  cat > "$WORKSPACE/README.md" <<'EOF'
# Your webcode sandbox

This is a disposable Linux micro-VM. Open a terminal, create files, and run
code — it's yours until it idles out. Nothing here persists once it's gone.

Try:  `python3 -c "print('hello')"`  ·  `git init`  ·  edit this file ✎
EOF
fi

exec node /app/packages/daemon/dist/index.js "$WORKSPACE"
