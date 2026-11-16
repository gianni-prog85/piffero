# Piffero vs Modern Streaming Parsers (`@sapientpro/json-stream`, `stream-json`, `json-web-streams`)

Full benchmark and parity comparison executed on the 38 MB GitHub events dataset ([large-file.json](../../spec/jsonFiles/large-file.json)) using [`compare-streaming.js`](../../benchmarking/compare-streaming.js).

```bash
npm run benchmark:streaming
```

## Libraries Tested

| Library | Version | Architecture | JSONPath / Selector Model |
|---|---|---|---|
| **Piffero** | `1.1.13` | Node.js `Readable` / string callback / Promise (Clarinet SAX) | Full JSONPath (`..`, `*`, `?()`, slices, unions, negative indexes, `()`) + auto early exit |
| **`@sapientpro/json-stream`** | `3.0.0` | Incremental TypeScript scanner (`onValue` callbacks) | Subset (`$.a`, `$[i]`, `*`, `..`); rejects `?()`, slices, unions, negative indexes |
| **`stream-json`** | `3.9.0` | Token pipeline (`parser` → `pick` → `streamValues` / `streamArray`) | String / RegExp / function path filters (no native JSONPath parser) |
| **`json-web-streams`** | `1.2.0` | Web `TransformStream` (`TextDecoderStream` → `JSONParseStream`) | Strict subset (`.key`, `['key']`, `.*`, `[*]`); rejects `[i]`, `..`, `?()`, slices, unions |

## Benchmark Results (38 MB JSON)

> Notes:
> - Piffero outputs serialized JSON (`[...]`), and the harness runs `JSON.parse()` to verify exact match counts; the other three parsers emit assembled JS objects directly.
> - For early-exit scenarios (`1` and `2`), Piffero terminates upstream automatically while `@sapientpro/json-stream` (`s.destroy()`) and `stream-json` (`once: true` + `input.destroy()`) use explicit manual teardown.

### 1. Early file (`$.[1].payload`, 1 match)

| Parser | Avg (ms) | Median (ms) | Ops/sec | Matches |
|---|---|---|---|---|
| **Piffero (string)** | **0.72** | **0.72** | **1380.94** | 1 |
| `@sapientpro/json-stream` | 0.85 | 0.59 | 1175.29 | 1 |
| `stream-json` | 4.57 | 4.90 | 218.58 | 1 |
| Piffero (stream) | 5.03 | 5.78 | 198.92 | 1 |
| `json-web-streams` | N/A | N/A | N/A | N/A (numeric index unsupported) |

### 2. Mid file (`$.[5000].payload`, 1 match)

| Parser | Avg (ms) | Median (ms) | Ops/sec | Matches |
|---|---|---|---|---|
| **`@sapientpro/json-stream`** | **97.31** | **94.72** | **10.28** | 1 |
| Piffero (string) | 191.88 | 188.48 | 5.21 | 1 |
| Piffero (stream) | 198.81 | 196.96 | 5.03 | 1 |
| `stream-json` | 371.11 | 363.49 | 2.69 | 1 |
| `json-web-streams` | N/A | N/A | N/A | N/A (numeric index unsupported) |

### 3. Root array elements (`$[*]`, 11,351 matches)

| Parser | Avg (ms) | Median (ms) | Ops/sec | Matches |
|---|---|---|---|---|
| **`json-web-streams`** | **255.60** | **251.81** | **3.91** | 11,351 |
| `@sapientpro/json-stream` | 452.15 | 445.89 | 2.21 | 11,351 |
| `stream-json` | 857.31 | 854.79 | 1.17 | 11,351 |
| Piffero (stream) | 945.22 | 889.53 | 1.06 | 11,351 |
| Piffero (string) | 1357.91 | 1436.27 | 0.74 | 11,351 |

### 4. Wildcard shallow (`$[*].actor.login`, 11,351 matches)

| Parser | Avg (ms) | Median (ms) | Ops/sec | Matches |
|---|---|---|---|---|
| **`@sapientpro/json-stream`** | **286.48** | **279.61** | **3.49** | 11,351 |
| `json-web-streams` | 295.66 | 294.90 | 3.38 | 11,351 |
| Piffero (stream) | 553.66 | 552.68 | 1.81 | 11,351 |
| Piffero (string) | 569.13 | 564.31 | 1.76 | 11,351 |
| `stream-json` | 1016.46 | 1014.76 | 0.98 | 11,351 |

### 5. Nested wildcard (`$[*].payload.commits[*].author.email`, 10,109 matches)

| Parser | Avg (ms) | Median (ms) | Ops/sec | Matches |
|---|---|---|---|---|
| **`json-web-streams`** | **307.38** | **307.81** | **3.25** | 10,109 |
| `@sapientpro/json-stream` | 332.62 | 331.90 | 3.01 | 10,109 |
| Piffero (stream) | 556.36 | 551.45 | 1.80 | 10,109 |
| Piffero (string) | 577.06 | 580.79 | 1.73 | 10,109 |
| `stream-json` | 996.00 | 994.53 | 1.00 | 10,109 |

### 6. Recursive descent (`$..user.login`, 4,272 matches)

| Parser | Avg (ms) | Median (ms) | Ops/sec | Matches |
|---|---|---|---|---|
| **`@sapientpro/json-stream`** | **551.23** | **547.53** | **1.81** | 4,272 |
| Piffero (stream) | 571.86 | 571.89 | 1.75 | 4,272 |
| Piffero (string) | 607.08 | 613.06 | 1.65 | 4,272 |
| `stream-json` | 991.77 | 990.65 | 1.01 | 4,272 |
| `json-web-streams` | N/A | N/A | N/A | N/A (`..` unsupported) |

### 7. Existence filter (`$[?(@.payload.issue)].payload.issue.number`, 1,389 matches)

| Parser | Avg (ms) | Median (ms) | Ops/sec | Matches |
|---|---|---|---|---|
| **Piffero (string)** | **780.11** | **781.99** | **1.28** | 1,389 |
| Piffero (stream) | 785.72 | 789.68 | 1.27 | 1,389 |
| `@sapientpro/json-stream` | N/A | N/A | N/A | N/A (filters unsupported) |
| `stream-json` | N/A | N/A | N/A | N/A (no JSONPath filter engine) |
| `json-web-streams` | N/A | N/A | N/A | N/A (filters unsupported) |

## Key Takeaways

- **Early-exit winner**: `Piffero.findAsString` is the fastest overall (`0.72 ms`) on `$.[1].payload` and handles early termination automatically without manual stream destruction.
- **Vs `stream-json`**: Piffero is **~1.7x–1.9x faster** than `stream-json` across mid-file lookups (`191.88 ms` vs `371.11 ms`), shallow wildcards (`553.66 ms` vs `1016.46 ms`), nested wildcards (`556.36 ms` vs `996.00 ms`), and recursive descent (`571.86 ms` vs `991.77 ms`), while also offering native JSONPath queries.
- **Vs `@sapientpro/json-stream` & `json-web-streams`**: Both are faster (~1.7x–3.7x) on pure wildcard scans when consuming in-process JS objects, and tie closely with Piffero on recursive descent (`551.23 ms` vs `571.86 ms`). However, **only Piffero** supports JSONPath filters `?()`, array slices, unions, negative indexes, automatic early termination, and direct JSON pass-through streaming (`[...]`).
- Verified in Jasmine parity suite: [`streamingParsersParitySpec.ts`](../../spec/piffero/streamingParsersParitySpec.ts).
