# Piffero vs Oboe vs `@streamparser/json` vs `jsonpath-plus`

Full 9-scenario benchmark and parity comparison executed on the 38 MB GitHub events dataset ([large-file.json](../../spec/jsonFiles/large-file.json)) using [`compare-parsers.js`](../../benchmarking/compare-parsers.js) and [`index.js`](../../benchmarking/index.js).

```bash
npm run benchmark:compare
npm run benchmark
```

## Extended 9-Scenario Results (`npm run benchmark:compare`)

| Scenario (matches extracted) | Piffero (stream) | Piffero (string) | Oboe | `@streamparser/json` | `jsonpath-plus` (in-memory) |
|---|---|---|---|---|---|
| Early file `$.[1].payload` (1) | 1.18 ms (848.90 ops/s) | **0.79 ms** (1258.64 ops/s) | 15.45 ms (64.72 ops/s) | 18.25 ms (54.79 ops/s) | 686.08 ms (1.46 ops/s) |
| Mid file `$.[5000].payload` (1) | 113.12 ms (8.84 ops/s) | **95.50 ms** (10.47 ops/s) | 551.78 ms (1.81 ops/s) | 276.18 ms (3.62 ops/s) | 240.05 ms (4.17 ops/s) |
| End file `$.[11350]...received_events_url` (1) | 210.39 ms (4.75 ops/s) | **201.48 ms** (4.96 ops/s) | 768.18 ms (1.30 ops/s) | 623.42 ms (1.60 ops/s) | 418.05 ms (2.39 ops/s) |
| Root array elements `$[*]` (11,351) | 651.75 ms (1.53 ops/s) | 603.66 ms (1.66 ops/s) | 845.62 ms (1.18 ops/s) | 542.56 ms (1.84 ops/s) | **254.00 ms** (3.94 ops/s) |
| Wildcard shallow `$[*].actor.login` (11,351) | 265.00 ms (3.77 ops/s) | 260.60 ms (3.84 ops/s) | 795.80 ms (1.26 ops/s) | 624.90 ms (1.60 ops/s) | **248.86 ms** (4.02 ops/s) |
| Nested wildcard `$[*].payload.commits[*].author.email` (10,109) | 305.31 ms (3.28 ops/s) | 288.80 ms (3.46 ops/s) | 792.39 ms (1.26 ops/s) | 646.10 ms (1.55 ops/s) | **271.73 ms** (3.68 ops/s) |
| Recursive descent `$..user.login` (4,272) | 479.85 ms (2.08 ops/s) | 476.67 ms (2.10 ops/s) | 800.98 ms (1.25 ops/s) | N/A (unsupported) | **310.04 ms** (3.23 ops/s) |
| Recursive + wildcard `$..commits[*].sha` (10,109) | 488.18 ms (2.05 ops/s) | 487.01 ms (2.05 ops/s) | 797.08 ms (1.25 ops/s) | N/A (unsupported) | **310.92 ms** (3.22 ops/s) |
| Existence filter vs duck-typing (1,389) | 307.55 ms (3.25 ops/s) | 310.46 ms (3.22 ops/s) | 776.80 ms (1.29 ops/s) | N/A (unsupported) | **261.61 ms** (3.82 ops/s) |

## Key Takeaways

- **Streaming vs in-memory (`jsonpath-plus`)**: `jsonpath-plus` must read and `JSON.parse()` the entire 38 MB document into RAM before evaluating a query. On early-file queries (`$.[1].payload`), Piffero is **~868x faster** (`0.79 ms` vs `686.08 ms`), and beats `jsonpath-plus` on both mid-file (`95.50 ms` vs `240.05 ms`, **~2.5x**) and end-of-file point lookups (`201.48 ms` vs `418.05 ms`, **~2.1x**), while nearly matching in-memory `jsonpath-plus` on selective wildcards (`260.60 ms` vs `248.86 ms`) and nested wildcards (`288.80 ms` vs `271.73 ms`) with bounded memory.
- **Safe nested filter traversal**: Where `jsonpath-plus` throws `TypeError` when an intermediate property in a filter path is missing (e.g. `@.address.city`), Piffero evaluates safely without crashing.
- **Streaming vs Oboe / `@streamparser/json`**: Piffero outperforms Oboe in **all 9 scenarios** (**~1.4x–19.6x faster**) and beats `@streamparser/json` in **5 of 6 supported scenarios** (**~2.2x–23.1x faster** on point lookups and selective wildcards, with `@streamparser/json` lacking `..` and `?()` support altogether), even while the harness pays a `JSON.parse` round-trip on Piffero's output.
- Verified in Jasmine parity suites: [`streamparserParitySpec.ts`](../../spec/piffero/streamparserParitySpec.ts) and [`jsonpathPlusParitySpec.ts`](../../spec/piffero/jsonpathPlusParitySpec.ts).
