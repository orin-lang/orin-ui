#!/usr/bin/env bash
# The server side writes scenarios (tools/fixtures), the client test applies them to a fake DOM and compares the result
# with the HTML the server renders for the same screens.
set -euo pipefail
cd "$(dirname "$0")/.."
ORIN="${ORIN:-orin}"
(cd tools/fixtures && "$ORIN" fetch >/dev/null && "$ORIN" run 2>/dev/null | grep '^{' > ../../client/test/fixtures.jsonl)
node client/test/client.test.js
