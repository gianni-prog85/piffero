# 200 MiB Scale Benchmark (`200.01 MiB` / `209.72 MB` JSON)

Large-scale 10-scenario benchmark comparison across 7 libraries on a **200.01 MiB** (**209.72 MB**, **62,683** GitHub event elements) dataset generated from [large-file.json](../../spec/jsonFiles/large-file.json) using [`compare-200mb.js`](../../benchmarking/compare-200mb.js).

```bash
npm run benchmark:200mb
```

## Benchmark Results (200 MiB JSON, avg ms)

| Scenario (matches extracted) | Piffero (stream) | Piffero (string) | `@sapientpro/json-stream` | `json-web-streams` | `stream-json` | `@streamparser/json` | `Oboe` | `jsonpath-plus` (in-memory) |
|---|---|---|---|---|---|---|---|---|
| **1. Early file** `$.[1].payload` (1) | 1.47 ms | **0.44 ms** | 0.77 ms | N/A | 3.05 ms | 0.93 ms | 10.51 ms | 3237.53 ms |
| **2. Mid file** `$.[31341].payload` (1) | 619.18 ms | **590.01 ms** | 624.34 ms | N/A | 2240.51 ms | 1712.21 ms | 3095.61 ms | 2013.73 ms |
| **3. End file** `$.[56754]...received_events_url` (1) | 1036.13 ms | **1007.26 ms** | 1116.58 ms | N/A | 3972.58 ms | 3103.23 ms | 3987.43 ms | 2036.98 ms |
| **4. Root array** `$[*]` (62,683) | 3637.70 ms | 3165.28 ms | 1923.56 ms | **1308.05 ms** | 4667.08 ms | 2990.10 ms | 4495.31 ms | 1356.90 ms |
| **5. Wildcard shallow** `$[*].actor.login` (62,683) | 1320.95 ms | 1349.54 ms | **1236.39 ms** | 1550.16 ms | 5517.31 ms | 3401.34 ms | 4216.74 ms | 1402.60 ms |
| **6. Nested wildcard** `$[*].payload.commits[*].author.email` (55,729) | 1498.37 ms | 1491.72 ms | 1788.61 ms | 1647.89 ms | 5463.27 ms | 3539.04 ms | 4248.27 ms | **1453.82 ms** |
| **7. Recursive descent** `$..user.login` (23,715) | 2473.69 ms | 2496.88 ms | 3018.34 ms | N/A | 5425.97 ms | N/A | 4115.83 ms | **1635.88 ms** |
| **8. Existence filter** `$[?(@.payload.issue)].payload.issue.number` (7,725) | 1599.74 ms | **1578.08 ms** | N/A | N/A | N/A | N/A | 4148.77 ms | **1406.57 ms** |
| **9. Array slice early-exit** `$[0:10:2]` (5) | 2.48 ms | **1.24 ms** | N/A | N/A | N/A | N/A | N/A | 2104.39 ms |
| **10. Reverse slice** `$[10:0:-1]` (10) | 1077.44 ms | **1054.89 ms** | N/A | N/A | N/A | N/A | N/A | 1840.44 ms |

## Key Takeaways

- **#1 overall on every point lookup and slice**: `Piffero (string)` beats every tested library—including in-memory `jsonpath-plus`—at start-of-file (**0.44 ms** vs `3237.53 ms`, **~7,358x**), mid-file (**590.01 ms** vs `2013.73 ms`, **~3.4x**), end-of-file (**1007.26 ms** vs `2036.98 ms`, **~2.0x**; and ahead of `@sapientpro/json-stream` at `1116.58 ms`), forward slice `$[0:10:2]` (**1.24 ms** vs `2104.39 ms`, **~1,697x**), and reverse slice `$[10:0:-1]` (**1054.89 ms** vs `1840.44 ms`, **~1.7x**; all other streaming parsers lack RFC 9535 slice support).
- **#1 streaming parser on nested wildcards, recursive descent, and filters**:
  - `$[*].payload.commits[*].author.email`: **1491.72 ms** (faster than `json-web-streams` `1647.89 ms`, `@sapientpro/json-stream` `1788.61 ms`, `@streamparser/json` `3539.04 ms`, `Oboe` `4248.27 ms`, and `stream-json` `5463.27 ms`).
  - `$..user.login`: **2473.69 ms** (faster than `@sapientpro/json-stream` `3018.34 ms`, `Oboe` `4115.83 ms`, and `stream-json` `5425.97 ms`).
  - `$[?(@.payload.issue)].payload.issue.number`: **1578.08 ms** (**~2.6x** faster than `Oboe` duck-typing at `4148.77 ms`; all other tested streaming parsers lack filter support).
- **Consistent bounded-memory scaling**: Scaling 5.35x from 38 MB to 200 MiB keeps Piffero's throughput linear while avoiding full-document V8 heap allocation.
