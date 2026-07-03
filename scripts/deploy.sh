#!/usr/bin/env bash
# Thin wrapper — runs the cross-platform Node deploy script.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/quick-deploy.mjs "$@"
