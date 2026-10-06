#!/bin/bash
# JS-vs-C++ parity + real-time checks for the Meat Thumb DSP port.
#   ./run_parity.sh [outDir]
# Needs: JavaScriptCore's jsc (ships with macOS), clang++, python3 + numpy.
set -euo pipefail
cd "$(dirname "$0")"
OUT="${1:-${TMPDIR:-/tmp}/meatthumb-parity}"
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
CXX="clang++ -std=c++17 -O2 -Wall -Wextra"
SDK_CXX=/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/c++/v1
[ -d "$SDK_CXX" ] && CXX="$CXX -isystem $SDK_CXX"

mkdir -p "$OUT/js" "$OUT/cpp"
echo "== JS render (src/dsp/meat-thumb-processor.js under jsc)"
"$JSC" -m render_js.mjs -- scenarios.txt "$OUT/js"
echo "== C++ render (mt::Engine)"
$CXX render_cpp.cpp ../Source/dsp/Engine.cpp -o "$OUT/render_cpp"
"$OUT/render_cpp" scenarios.txt "$OUT/cpp"
echo "== Compare (128-frame host blocks)"
python3 compare.py "$OUT/js" "$OUT/cpp"

# Odd host buffer sizes with notes landing mid-buffer. Only scenarios whose
# non-note commands all sit at block 0 are comparable in this mode.
for HB in 37 100 512 1000; do
  mkdir -p "$OUT/cpp$HB"
  "$OUT/render_cpp" scenarios.txt "$OUT/cpp$HB" all $HB | grep ', comparable' | sed 's/:.*//' > "$OUT/comparable$HB.txt"
  echo "== Compare (host block $HB, $(wc -l < "$OUT/comparable$HB.txt" | tr -d ' ') comparable scenarios)"
  python3 compare.py "$OUT/js" "$OUT/cpp$HB" > "$OUT/cmp$HB.txt" || true  # non-comparable ones fail by design
  RES=$(grep -F -f "$OUT/comparable$HB.txt" "$OUT/cmp$HB.txt")
  echo "$RES" | grep -c PASS | sed 's/$/ PASS/'
  if echo "$RES" | grep FAIL; then exit 1; fi
done

echo "== Real-time checks + benchmark"
$CXX bench_cpp.cpp ../Source/dsp/Engine.cpp -o "$OUT/bench_cpp"
"$OUT/bench_cpp"
