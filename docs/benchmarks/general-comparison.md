# Piffero vs Oboe vs `@streamparser/json` vs `jsonpath-plus`

Full 9-scenario benchmark and parity comparison executed on the 38 MB GitHub events dataset ([large-file.json](../../spec/jsonFiles/large-file.json)) using [`compare-parsers.js`](../../benchmarking/compare-parsers.js) and [`index.js`](../../benchmarking/index.js).

```bash
npm run benchmark:compare
npm run benchmark
```

## Extended 9-Scenario Results (`npm run benchmark:compare`)

| Scenario (matches extracted) | Piffero (stream) | Piffero (string) | Oboe | `@streamparser/json` | `jsonpath-plus` (in-memory) |
|---|---|---|---|---|---|
| Early file `$.[1].payload` (1) | 5.16 ms (193.68 ops/s) | **1.05 ms** (950.58 ops/s) | 11.17 ms (89.49 ops/s) | 14.33 ms (69.80 ops/s) | 506.67 ms (1.97 ops/s) |
| Mid file `$.[5000].payload` (1) | **152.39 ms** (6.56 ops/s) | 154.78 ms (6.46 ops/s) | 456.73 ms (2.19 ops/s) | 208.64 ms (4.79 ops/s) | 192.52 ms (5.19 ops/s) |
| End file `$.[11350]...received_events_url` (1) | 326.92 ms (3.06 ops/s) | 307.37 ms (3.25 ops/s) | 641.68 ms (1.56 ops/s) | 484.39 ms (2.06 ops/s) | **192.57 ms** (5.19 ops/s) |
| Root array elements `$[*]` (11,351) | 782.44 ms (1.28 ops/s) | 872.91 ms (1.15 ops/s) | 644.34 ms (1.55 ops/s) | 404.21 ms (2.47 ops/s) | **200.57 ms** (4.99 ops/s) |
| Wildcard shallow `$[*].actor.login` (11,351) | 414.60 ms (2.41 ops/s) | 420.86 ms (2.38 ops/s) | 673.17 ms (1.49 ops/s) | 476.42 ms (2.10 ops/s) | **232.16 ms** (4.31 ops/s) |
| Nested wildcard `$[*].payload.commits[*].author.email` (10,109) | **447.17 ms** (2.24 ops/s) | 480.17 ms (2.08 ops/s) | 607.29 ms (1.65 ops/s) | 496.08 ms (2.02 ops/s) | 507.93 ms (1.97 ops/s) |
| Recursive descent `$..user.login` (4,272) | 484.20 ms (2.07 ops/s) | 442.42 ms (2.26 ops/s) | 610.31 ms (1.64 ops/s) | N/A (unsupported) | **291.56 ms** (3.43 ops/s) |
| Recursive + wildcard `$..commits[*].sha` (10,109) | 492.12 ms (2.03 ops/s) | 465.11 ms (2.15 ops/s) | 664.31 ms (1.51 ops/s) | N/A (unsupported) | **344.00 ms** (2.91 ops/s) |
| Existence filter vs duck-typing (1,389) | 678.07 ms (1.47 ops/s) | 644.61 ms (1.55 ops/s) | 611.49 ms (1.64 ops/s) | N/A (unsupported) | **285.41 ms** (3.50 ops/s) |

## Key Takeaways

- **Streaming vs in-memory (`jsonpath-plus`)**: `jsonpath-plus` must read and `JSON.parse()` the entire 38 MB document into RAM before evaluating a query. On early-file queries (`$.[1].payload`), Piffero is **~480x faster** (`1.05 ms` vs `506.67 ms`) and also beats `jsonpath-plus` on mid-file queries (`152.39 ms` vs `192.52 ms`) and nested wildcards (`447.17 ms` vs `507.93 ms`)—with bounded memory on larger-than-RAM payloads.
- **Safe nested filter traversal**: Where `jsonpath-plus` throws `TypeError` when an intermediate property in a filter path is missing (e.g. `@.address.city`), Piffero evaluates safely without crashing.
- **Streaming vs Oboe / `@streamparser/json`**: Piffero outperforms both Oboe and `@streamparser/json` on early-exit, mid-file, end-file, selective wildcard, and recursive-descent queries, even when the harness pays a `JSON.parse` round-trip on Piffero's output.
- Verified in Jasmine parity suites: [`streamparserParitySpec.ts`](../../spec/piffero/streamparserParitySpec.ts) and [`jsonpathPlusParitySpec.ts`](../../spec/piffero/jsonpathPlusParitySpec.ts).
