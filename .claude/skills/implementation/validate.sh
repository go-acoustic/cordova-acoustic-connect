#!/bin/bash
# Validation script for JIRA ticket implementation (Acoustic Connect Cordova plugin)
# Runs TypeScript type check, ESLint, Jest unit tests, and a Cordova demo build.
# Full device/emulator tests run on CI (Jenkins) — not required locally.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DEMO_APP_DIR="$REPO_ROOT/applications/Demo"

echo "========================================"
echo "Running Acoustic Connect Cordova Plugin Validation"
echo "========================================"

cd "$REPO_ROOT"

# ── Step 1/4: TypeScript type check ──────────────────────────────────────────
echo ""
echo "=== Step 1/4: TypeScript type check ==="
if [ -f "tsconfig.json" ]; then
    npx tsc --noEmit
    echo "✅ TypeScript type check passed"
else
    echo "⚠️  tsconfig.json not found — skipping type check"
fi

# ── Step 2/4: ESLint ─────────────────────────────────────────────────────────
echo ""
echo "=== Step 2/4: ESLint ==="
if [ -f ".eslintrc.js" ] || [ -f ".eslintrc.json" ] || [ -f ".eslintrc.yml" ] || [ -f "eslint.config.js" ]; then
    npx eslint src --ext .ts
    echo "✅ ESLint passed"
else
    echo "⚠️  ESLint config not found — skipping lint"
fi

# ── Step 3/4: Unit tests ─────────────────────────────────────────────────────
echo ""
echo "=== Step 3/4: Unit tests (Jest) ==="
if [ -f "package.json" ] && grep -q '"test"' package.json; then
    npm test -- --coverage --ci
    echo "✅ Unit tests passed"
    echo "   Coverage report: coverage/lcov-report/index.html"
else
    echo "⚠️  No test script found in package.json — skipping unit tests"
fi

# ── Step 4/4: Demo app build ─────────────────────────────────────────────────
echo ""
echo "=== Step 4/4: Demo app build (Cordova) ==="
if command -v cordova &>/dev/null; then
    if [ -d "$DEMO_APP_DIR" ]; then
        echo "Building demo app at: $DEMO_APP_DIR"
        cd "$DEMO_APP_DIR"
        [ -d "node_modules" ] || npm install
        cordova build android --verbose
        echo "✅ Demo app build passed"
    else
        echo "⚠️  Demo app directory not found at $DEMO_APP_DIR — skipping"
    fi
else
    echo "⚠️  cordova CLI not found — install with: npm install -g cordova"
    echo "   Skipping demo app build (CI will run this step)"
fi

echo ""
echo "========================================"
echo "✅ All checks passed"
echo "========================================"
echo ""
echo "Note: Full device/emulator tests run on CI (Jenkins)."
echo ""
echo "Next steps:"
echo "1. Create pull request:"
echo "   .claude/skills/implementation/create-pr.sh CA-XXXXXX 'description'"
echo "2. CI will run the full Cordova build + SonarQube — resolve any critical/blocker issues before merge"