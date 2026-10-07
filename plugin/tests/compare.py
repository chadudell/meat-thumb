#!/usr/bin/env python3
"""Compare JS and C++ renders: python3 compare.py <jsDir> <cppDir> [threshold]"""
import os
import sys

import numpy as np

js_dir, cpp_dir = sys.argv[1], sys.argv[2]
thr = float(sys.argv[3]) if len(sys.argv) > 3 else 1e-4
names = sorted(f[:-4] for f in os.listdir(js_dir) if f.endswith('.f32'))
print(f"{'scenario':24s} {'frames':>7s} {'sig RMS':>9s} {'max |err|':>10s} {'err RMS/sig RMS':>16s} {'first >1e-6':>12s}  result")
fails = 0
for n in names:
    a = np.fromfile(os.path.join(js_dir, n + '.f32'), dtype='<f4').astype(np.float64)
    p = os.path.join(cpp_dir, n + '.f32')
    if not os.path.exists(p):
        print(f'{n:24s} missing C++ render')
        fails += 1
        continue
    b = np.fromfile(p, dtype='<f4').astype(np.float64)
    if a.shape != b.shape:
        print(f'{n:24s} length mismatch {a.shape} vs {b.shape}')
        fails += 1
        continue
    frames = a.size // 2
    d = np.abs(a - b)
    sig = np.sqrt(np.mean(a * a))
    rel = np.sqrt(np.mean(d * d)) / sig if sig > 0 else float(np.sqrt(np.mean(d * d)))
    bad = np.nonzero(d > 1e-6)[0]
    first = '-' if bad.size == 0 else f'{(bad[0] % frames)}{"L" if bad[0] < frames else "R"}'
    ok = rel < thr and np.all(np.isfinite(b))
    fails += 0 if ok else 1
    print(f'{n:24s} {frames:7d} {sig:9.4f} {d.max():10.3e} {rel:16.3e} {first:>12s}  {"PASS" if ok else "FAIL"}')
print(f'\n{len(names) - fails}/{len(names)} scenarios within {thr:g} relative error')
sys.exit(1 if fails else 0)
