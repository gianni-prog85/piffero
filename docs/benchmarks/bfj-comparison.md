# Piffero vs `bfj` (`v9.1.4`)

Full benchmark and parity comparison executed on the 38 MB GitHub events dataset ([large-file.json](../../spec/jsonFiles/large-file.json)) using [`compare-bfj.js`](../../benchmarking/compare-bfj.js).

```bash
npm run benchmark:bfj
```

## Benchmark Results (38 MB JSON)

| Scenario (matches extracted) | Piffero (stream) | Piffero (string) | `bfj` (`bfj.match`) |
|---|---|---|---|
| Early file `$.[1].payload` vs predicate (1) | 5.89 ms (169.87 ops/s) | **0.89 ms** (1124.97 ops/s) | 4.10 ms (244.20 ops/s) |
| Mid file `$.[5000].payload` vs predicate (1) | 157.58 ms (6.35 ops/s) | **151.84 ms** (6.59 ops/s) | 4156.29 ms (0.24 ops/s) |
| Root array elements `$[*]` vs depth-1 predicate (11,351) | **750.76 ms** (1.33 ops/s) | 951.80 ms (1.05 ops/s) | 10295.22 ms (0.10 ops/s) |
| Recursive key `$..login` vs key selector `'login'` (21,151) | **469.57 ms** (2.13 ops/s) | 499.38 ms (2.00 ops/s) | 10268.78 ms (0.10 ops/s) |
| Existence filter `$[?(@.payload.issue)]...` (1,389) | **621.14 ms** (1.61 ops/s) | 670.08 ms (1.49 ops/s) | N/A (unsupported) |

## Technical Notes & Limitations Observed in `bfj@9.1.4`

- **Throughput**: `bfj` prioritizes cooperative event-loop yielding over parsing speed. Piffero is **13.7x–27.4x faster** on mid-file lookups, root element scans, and recursive key extraction.
- **Broken `$.` JSONPath support on arrays**: `bfj.match` throws on `$.*` and `$..number`, and returns `0` matches on valid array JSONPath expressions such as `$.phoneNumbers[*].number`. Only plain key strings (`'login'`) and custom JS predicate functions `(key, value, depth) => boolean` work reliably.
- **Drops `null` values**: Because Node.js object-mode streams interpret `null` as EOF, `bfj.match` skips all JSON `null` values (e.g. `$..null` returns `[]` in `bfj` vs `[null]` in Piffero).
- Verified in Jasmine parity suite: [`bfjParitySpec.ts`](../../spec/piffero/bfjParitySpec.ts).
