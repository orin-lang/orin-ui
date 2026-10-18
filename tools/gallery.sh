#!/usr/bin/env bash
# Renders examples/kit-gallery (every kit component on one page) to build/gallery/index.html, with the stylesheet and script beside it.
#   tools/gallery.sh && open build/gallery/index.html
set -euo pipefail
cd "$(dirname "$0")/.."
ORIN="${ORIN:-orin}"
(cd examples/kit-gallery && "$ORIN" fetch >/dev/null && "$ORIN" build --quiet)
mkdir -p build/gallery
examples/kit-gallery/build/dev/kit-gallery > build/gallery/index.html
cp client/orin-ui-kit.css client/orin-ui-kit.js build/gallery/
echo "build/gallery/index.html"
