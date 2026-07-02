#!/usr/bin/env bash
# Optimize KRAMER site images in place for fast plate loading:
#   - cap the long edge at 2000px (only downscales, never upscales)
#   - re-encode JPEG at a moderate quality
# Uses macOS built-in `sips` only (no ImageMagick needed).
#
# Usage:
#   bash build/optimize-images.sh                       # all JPGs in images/works + images/artists
#   bash build/optimize-images.sh images/works/foo.jpg  # just the file(s) you pass
#
# Note: re-encoding is lossy, so run it once on freshly-added originals. Passing
# specific files (rather than the whole dir) avoids re-compressing already-optimized plates.
set -euo pipefail
MAX=2000
Q=72

targets=("$@")
[ ${#targets[@]} -eq 0 ] && targets=(images/works images/artists)

process() {
  local f="$1"
  [ -f "$f" ] || return 0
  local w h long before after
  w=$(sips -g pixelWidth  "$f" | awk '/pixelWidth/{print $2}')
  h=$(sips -g pixelHeight "$f" | awk '/pixelHeight/{print $2}')
  long=$(( w > h ? w : h ))
  before=$(stat -f%z "$f")
  if [ "$long" -gt "$MAX" ]; then sips -Z "$MAX" "$f" >/dev/null; fi
  sips -s format jpeg -s formatOptions "$Q" "$f" --out "$f" >/dev/null
  after=$(stat -f%z "$f")
  printf '%-60s %5sx%-5s %4dK -> %4dK\n' "$f" "$w" "$h" $((before/1024)) $((after/1024))
}

shopt -s nullglob nocaseglob
for t in "${targets[@]}"; do
  if [ -d "$t" ]; then
    for f in "$t"/*.jpg "$t"/*.jpeg; do process "$f"; done
  else
    process "$t"
  fi
done
