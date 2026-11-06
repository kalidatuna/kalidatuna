#!/usr/bin/env bash
# Starts a fresh Lumora server (empty database, demo billing) for end-to-end tests.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
BIN="${LUMORA_BIN:-$ROOT/server/target/release/lumora}"
[ -x "$BIN" ] || BIN="$ROOT/server/target/debug/lumora"
DB_DIR="$(mktemp -d)"
export DATABASE_URL="sqlite://$DB_DIR/e2e.db"
export CONTENT_DIR="$ROOT/content"
export STATIC_DIR="$ROOT/web/dist"
export BIND="127.0.0.1:${E2E_PORT:-8090}"
export PUBLIC_URL="http://127.0.0.1:${E2E_PORT:-8090}"
export BILLING_MODE=demo
export ADMIN_EMAILS=admin@e2e.test
export AUTH_RATE_PER_MINUTE=500
exec "$BIN"
