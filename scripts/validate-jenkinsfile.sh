#!/usr/bin/env bash
# validate-jenkinsfile.sh
#
# Statically validates the Jenkinsfile and supporting files for common pitfalls
# that only surface at CI time:
#
#   1. ConnectConfig.example.json exists — the CI seed step copies it to
#      ConnectConfig.json so hooks and Gradle scripts can read useRelease.
#   2. build-extras.gradle does not reference connect-push-fcm-debug — that
#      artifact is not published to public Maven Central.
#   3. Every `cordova plugin add` must be preceded by `cordova plugin remove`
#      in the same sh block (prevents "already exists" on stale iOS platform files).
#
# SDK variant is driven by ConnectConfig.json.Connect.useRelease — there is
# no --variable ACOUSTIC_SDK_VARIANT= flag to validate.
#
# Usage:  bash scripts/validate-jenkinsfile.sh [Jenkinsfile]
# Exit:   0 = pass, 1 = failures found

set -euo pipefail

JENKINSFILE="${1:-Jenkinsfile}"

if [[ ! -f "$JENKINSFILE" ]]; then
  echo "ERROR: $JENKINSFILE not found" >&2
  exit 1
fi

fail=0

# --- Static file checks (not Jenkinsfile-specific) ---

# Check 1: ConnectConfig.example.json must exist so the CI seed step has a source.
EXAMPLE_CONFIG="applications/Demo/ConnectConfig.example.json"
if [[ ! -f "$EXAMPLE_CONFIG" ]]; then
  echo "FAIL: $EXAMPLE_CONFIG not found — CI cannot seed ConnectConfig.json"
  fail=1
else
  echo "  OK: $EXAMPLE_CONFIG exists"
fi

# Check 2: build-extras.gradle must not reference connect-push-fcm-debug
#           (that artifact is not published to public Maven).
BUILD_EXTRAS="plugins/cordova-acoustic-mobile-connect-push/src/android/build-extras.gradle"
if [[ -f "$BUILD_EXTRAS" ]] && grep -q 'connect-push-fcm-debug' "$BUILD_EXTRAS"; then
  echo "FAIL: $BUILD_EXTRAS references connect-push-fcm-debug — this artifact is not on Maven Central"
  fail=1
else
  echo "  OK: $BUILD_EXTRAS does not reference connect-push-fcm-debug"
fi

echo ""

# --- Jenkinsfile sequence checks ---
# Write the Python extractor to a temp file to avoid heredoc encoding issues.
EXTRACTOR=$(mktemp /tmp/jf_check.XXXXXX.py)
trap 'rm -f "$EXTRACTOR"' EXIT

cat > "$EXTRACTOR" << 'PYEOF'
import sys, re

text = open(sys.argv[1], encoding='utf-8').read()
pattern = re.compile(r'sh\s+"""(.*?)"""', re.DOTALL)

for i, m in enumerate(pattern.finditer(text)):
    block = m.group(1)
    lines = block.splitlines()

    plugin_add_indices    = [n for n, l in enumerate(lines) if 'cordova plugin add'    in l]
    plugin_remove_indices = [n for n, l in enumerate(lines) if 'cordova plugin remove' in l]

    for add_idx in plugin_add_indices:
        add_line = lines[add_idx].strip()
        has_prior_remove = any(r < add_idx for r in plugin_remove_indices)
        start_line = text[:m.start()].count('\n') + 1
        print(f"{start_line}|{add_idx}|{int(has_prior_remove)}|{add_line}")
PYEOF

echo "Checking $JENKINSFILE …"
echo ""

while IFS='|' read -r block_start cmd_offset has_remove cmd; do
  approx_line=$(( block_start + cmd_offset ))

  if [[ "$has_remove" == "0" ]]; then
    echo "FAIL line ~${approx_line}: 'cordova plugin add' has no preceding 'cordova plugin remove' in same sh block"
    echo "     → $cmd"
    fail=1
  else
    echo "  OK line ~${approx_line}: 'cordova plugin remove' precedes 'cordova plugin add'"
  fi

done < <(python3 "$EXTRACTOR" "$JENKINSFILE")

echo ""
if [[ $fail -eq 0 ]]; then
  echo "All checks passed."
else
  echo "One or more checks failed — fix before pushing."
  exit 1
fi
