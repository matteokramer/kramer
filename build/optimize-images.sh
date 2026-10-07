#!/usr/bin/env bash
# Optimize KRAMER site images in place for fast plate loading:
#   - cap the long edge at 1600px (only downscales, never upscales)
#   - re-encode JPEG at a moderate quality
# Uses macOS built-in `sips` only (no ImageMagick needed).
#
# Usage:
#   bash build/optimize-images.sh                       # all JPGs in images/works + images/installation + images/artists
#   bash build/optimize-images.sh images/works/foo.jpg  # just the file(s) you pass
#   MAX=2400 Q=80 bash build/optimize-images.sh f.jpg   # override the caps for one run
#
# Note: re-encoding is lossy, so run it once on freshly-added originals. Passing
# specific files (rather than the whole dir) avoids re-compressing already-optimized plates.
# The archive copies (DOCUMENTATION/<show>/_Exports) are the originals — nothing here is.
#
# Why 1600/65 (changed 2026-10-07, down from 2000/72): a plate is drawn into a frame of
# clamp(240px,60vh,600px) with object-fit:contain, so even a 3x phone never needs more than
# ~1600px on the long edge. At 2000/72 the plates ran 700K-1.4M each and an artist page cost
# 2-5.5 MB; this cuts that by about two thirds with nothing visible at the rendered size.
set -euo pipefail
MAX=${MAX:-1600}
Q=${Q:-65}

targets=("$@")
[ ${#targets[@]} -eq 0 ] && targets=(images/works images/installation images/artists)

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
