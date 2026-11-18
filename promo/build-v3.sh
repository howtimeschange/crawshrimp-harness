#!/bin/sh
set -eu

here=$(CDPATH='' cd "$(dirname "$0")" && pwd)
output=${1:-"$here/crawshrimp-harness-promo-v3.mp4"}
output_dir=$(CDPATH='' cd "$(dirname "$output")" && pwd)
output="$output_dir/$(basename "$output")"
jobs=${PROMO_JOBS:-4}
python=${PROMO_PYTHON:-python3}
case $jobs in ''|*[!0-9]*) echo 'PROMO_JOBS must be a positive integer.' >&2; exit 2;; esac
if [ "$jobs" -eq 0 ]; then
  echo 'PROMO_JOBS must be a positive integer.' >&2
  exit 2
fi

build=$(mktemp -d "$output_dir/.v3-build.XXXXXX")
pids=
cleanup() {
  for pid in $pids; do kill "$pid" 2>/dev/null || true; done
  rm -rf "$build"
}
trap cleanup 0
trap 'exit 130' INT
trap 'exit 143' TERM

part=0
while [ "$part" -lt "$jobs" ]; do
  node "$here/render-60fps.cjs" "$part" "$jobs" "$build" &
  pids="$pids $!"
  part=$((part + 1))
done
failed=0
for pid in $pids; do wait "$pid" || failed=1; done
pids=
[ "$failed" -eq 0 ] || exit 1

"$python" "$here/audio-v3.py" --events "$build/events.json" --output "$build/audio3_raw.wav"
ffmpeg -nostdin -hide_banner -loglevel error \
  -framerate 240 -i "$build/sub/s%06d.jpg" -i "$build/audio3_raw.wav" \
  -vf "tmix=frames=4:weights='1 1 1 1',select='eq(mod(n,4),3)',setpts=N/(60*TB),format=yuv420p" \
  -r 60 -c:v libx264 -crf 18 -c:a aac -b:a 192k -movflags +faststart "$build/promo.mp4"
mv -f "$build/promo.mp4" "$output"
