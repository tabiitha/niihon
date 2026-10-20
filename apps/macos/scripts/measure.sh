#!/bin/sh
# Launches build/Nihon.app in measurement mode (`--probe`) several times in a row and prints one JSON line
# per launch: the time from process start to the first connected window, and the memory footprint after
# each of twenty window open/close cycles that also visit every space. A Nihon service must already
# answer at the address the app uses (default http://127.0.0.1:4000; pass `-NihonServiceURL <url>` after
# the run count to change it).
#
#   apps/macos/scripts/measure.sh [runs] [app arguments…]
set -eu

cd "$(dirname "$0")/.."
runs="${1:-3}"
[ "$#" -gt 0 ] && shift
binary=build/Nihon.app/Contents/MacOS/Nihon
if [ ! -x "$binary" ]; then
  echo "Build the app first: apps/macos/scripts/build-app.sh" >&2
  exit 1
fi

run=1
while [ "$run" -le "$runs" ]; do
  "$binary" --probe "$@"
  run=$((run + 1))
done
