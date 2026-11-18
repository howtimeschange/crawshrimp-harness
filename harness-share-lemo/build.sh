#!/bin/sh
set -eu

if [ "$#" -gt 1 ] || [ -z "${1:-${LEMO_ROOT:-}}" ]; then
  echo "Usage: $0 /path/to/lemo-opuscar (or set LEMO_ROOT)" >&2
  exit 2
fi

here=$(CDPATH='' cd "$(dirname "$0")" && pwd)
lemo=$(CDPATH='' cd "${1:-$LEMO_ROOT}" && pwd)
if [ ! -f "$lemo/core/render/still.mjs" ] || [ ! -f "$lemo/core/render/sheet.py" ]; then
  echo 'LEMO_ROOT must point to a Lemo Opuscar checkout.' >&2
  exit 2
fi

python=${LEMO_PYTHON:-"$lemo/.venv/bin/python"}
if [ -z "${LEMO_PYTHON:-}" ] && [ ! -x "$python" ]; then
  python=python3
fi

node "$lemo/core/render/still.mjs" "$here" 0 1 2 --size 1200x630 --out "$here/out"
cp "$here/out/t_2.jpg" "$here/poster.jpg"
"$python" "$lemo/core/render/sheet.py" "$here/style-frames.jpg" \
  "$here/out/t_0.jpg" "$here/out/t_1.jpg" "$here/out/t_2.jpg" --cols 3 --w 600
