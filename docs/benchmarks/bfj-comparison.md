# Piffero vs `bfj` (`v9.1.4`)

Full benchmark and parity comparison executed on the 38 MB GitHub events dataset ([large-file.json](../../spec/jsonFiles/large-file.json)) using [`compare-bfj.js`](../../benchmarking/compare-bfj.js).

```bash
npm run benchmark:bfj
```

## Benchmark Results (38 MB JSON)

| Scenario (matches extracted) | Piffero (stream) | Piffero (string) | `bfj` (`bfj.match`) |
|---|---|---|---|
| Early file `$.[1].payload` vs predicate (1) | 1.83 ms (546.56 ops/s) | **0.67 ms** (1498.28 ops/s) | 2.67 ms (374.63 ops/s) |
| Mid file `$.[5000].payload` vs predicate (1) | 104.65 ms (9.56 ops/s) | **94.12 ms** (10.62 ops/s) | 4363.20 ms (0.23 ops/s) |
| Root array elements `$[*]` vs depth-1 predicate (11,351) | 631.60 ms (1.58 ops/s) | **583.19 ms** (1.71 ops/s) | 9566.94 ms (0.10 ops/s) |
| Recursive key `$..login` vs key selector `'login'` (21,151) | 502.46 ms (1.99 ops/s) | **498.28 ms** (2.01 ops/s) | 9887.61 ms (0.10 ops/s) |
| Existence filter `$[?(@.payload.issue)]...` (1,389) | 303.70 ms (3.29 ops/s) | **299.15 ms** (3.34 ops/s) | N/A (unsupported) |

## Technical Notes & Limitations Observed in `bfj@9.1.4`

- **Throughput**: `bfj` prioritizes cooperative event-loop yielding over parsing speed. Piffero is **~4x faster** on early-file lookups (`0.67 ms` vs `2.67 ms`) and **~16.4x–46.4x faster** on root element scans, recursive key extraction, and mid-file lookups.
- **Broken `$.` JSONPath support on arrays**: `bfj.match` throws on `$.*` and `$..number`, and returns `0` matches on valid array JSONPath expressions such as `$.phoneNumbers[*].number`. Only plain key strings (`'login'`) and custom JS predicate functions `(key, value, depth) => boolean` work reliably.
- **Drops `null` values**: Because Node.js object-mode streams interpret `null` as EOF, `bfj.match` skips all JSON `null` values (e.g. `$..null` returns `[]` in `bfj` vs `[null]` in Piffero).
- Verified in Jasmine parity suite: [`bfjParitySpec.ts`](../../spec/piffero/bfjParitySpec.ts).
