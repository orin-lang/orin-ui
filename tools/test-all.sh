#!/usr/bin/env bash
# Runs every test of orin-ui: the Orin unit tests, the examples' tests, the JavaScript client tests against fixtures made by
# the Orin side, and a native-versus-wasm32-orbit comparison of the examples.
#
#   tools/test-all.sh            ORIN=/path/to/orin tools/test-all.sh
#
# ORIN defaults to `orin` from PATH. The wasm step needs clang with the WebAssembly backend, wasm-ld and node (see
# tools/test-wasm.sh); it is skipped with a note when they are missing.
set -euo pipefail
cd "$(dirname "$0")/.."
ORIN="${ORIN:-orin}"

echo "== module architecture"
ORIN="$ORIN" tools/check_modules.sh

echo "== unit tests"
"$ORIN" test

echo "== example tests"
for ex in examples/*/; do
  if [ -d "$ex/tests" ]; then
    (cd "$ex" && "$ORIN" fetch >/dev/null && "$ORIN" test)
  fi
done

echo "== client tests"
tools/test-client.sh

echo "== formatting"
"$ORIN" fmt --check src tests examples tools/fixtures/src

echo "== wasm32-orbit"
tools/test-wasm.sh
