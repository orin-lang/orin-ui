#!/usr/bin/env bash
# Builds the examples for wasm32-orbit and checks that they print exactly what the native build prints.
#
# The module is run with tools/wasm_run.mjs of the Orin toolchain (a minimal Orbit host for tests); set ORIN_TOOLCHAIN to the
# toolchain checkout, or WASM_RUN to the runner. Without them, or without node / wasm-ld, the step is skipped.
set -euo pipefail
cd "$(dirname "$0")/.."
ORIN="${ORIN:-orin}"
RUN="${WASM_RUN:-${ORIN_TOOLCHAIN:+$ORIN_TOOLCHAIN/tools/wasm_run.mjs}}"
if [ -z "${RUN:-}" ] || [ ! -f "$RUN" ] || ! command -v node >/dev/null || ! command -v wasm-ld >/dev/null; then
  echo "skipped: set ORIN_TOOLCHAIN (a checkout of orin-lang) and install node and wasm-ld"
  exit 0
fi
status=0
for ex in examples/counter examples/todo tools/fixtures; do
  name=$(sed -n 's/^name = "\(.*\)"/\1/p' "$ex/orin.toml" | head -1)
  (cd "$ex" && "$ORIN" fetch >/dev/null && "$ORIN" build --quiet && "$ORIN" build --quiet --target=wasm32-orbit)
  native=$("$ex/build/dev/$name")
  wasm=$(node "$RUN" "$ex/build/dev/$name.wasm")
  if [ "$native" = "$wasm" ]; then
    echo "ok: $name prints the same natively and on wasm32-orbit"
  else
    echo "DIFFERENT: $name"; diff <(echo "$native") <(echo "$wasm") | head -20; status=1
  fi
done
exit $status
