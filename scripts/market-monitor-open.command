#!/bin/bash
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$PROJECT_DIR" || exit 1

if command -v pnpm >/dev/null 2>&1; then
  exec pnpm market-monitor:open
fi

if command -v corepack >/dev/null 2>&1; then
  exec corepack pnpm market-monitor:open
fi

echo "pnpm is unavailable. Run 'corepack enable' in Terminal, then open this file again."
read -r -p "Press Return to close…"
exit 1
