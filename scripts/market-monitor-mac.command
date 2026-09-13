#!/bin/bash
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$PROJECT_DIR" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "OpenAlice needs Node.js 22.19 or newer. Install it, then run this file again."
  read -r -p "Press Return to close…"
  exit 1
fi

if command -v pnpm >/dev/null 2>&1; then
  if [ ! -d node_modules/.pnpm ]; then pnpm install || exit 1; fi
  exec pnpm market-monitor:mac
fi

if command -v corepack >/dev/null 2>&1; then
  if [ ! -d node_modules/.pnpm ]; then corepack pnpm install || exit 1; fi
  exec corepack pnpm market-monitor:mac
fi

echo "pnpm is unavailable. Run 'corepack enable' in Terminal, then open this file again."
read -r -p "Press Return to close…"
exit 1
