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
| **Piffero (string)** | **0.63** | **0.62** | **1582.57** | 1 |
| `@sapientpro/json-stream` | 0.72 | 0.65 | 1394.52 | 1 |
| Piffero (stream) | 0.87 | 0.62 | 1151.11 | 1 |
| `stream-json` | 7.81 | 7.30 | 128.09 | 1 |
| `json-web-streams` | N/A | N/A | N/A | N/A (numeric index unsupported) |

### 2. Mid file (`$.[5000].payload`, 1 match)

| Parser | Avg (ms) | Median (ms) | Ops/sec | Matches |
|---|---|---|---|---|
| **`@sapientpro/json-stream`** | **96.50** | **95.98** | **10.36** | 1 |
| Piffero (string) | 106.31 | 107.53 | 9.41 | 1 |
| Piffero (stream) | 128.22 | 105.63 | 7.80 | 1 |
| `stream-json` | 378.09 | 373.16 | 2.64 | 1 |
| `json-web-streams` | N/A | N/A | N/A | N/A (numeric index unsupported) |

### 3. Root array elements (`$[*]`, 11,351 matches)

| Parser | Avg (ms) | Median (ms) | Ops/sec | Matches |
|---|---|---|---|---|
| **`json-web-streams`** | **258.04** | **261.45** | **3.88** | 11,351 |
| `@sapientpro/json-stream` | 459.77 | 465.97 | 2.18 | 11,351 |
| Piffero (string) | 695.49 | 693.57 | 1.44 | 11,351 |
| Piffero (stream) | 756.51 | 794.71 | 1.32 | 11,351 |
| `stream-json` | 895.20 | 893.83 | 1.12 | 11,351 |

### 4. Wildcard shallow (`$[*].actor.login`, 11,351 matches)

| Parser | Avg (ms) | Median (ms) | Ops/sec | Matches |
|---|---|---|---|---|
| **Piffero (string)** | **258.44** | **258.64** | **3.87** | 11,351 |
| **Piffero (stream)** | **261.39** | **258.56** | **3.83** | 11,351 |
| `@sapientpro/json-stream` | 279.07 | 276.21 | 3.58 | 11,351 |
| `json-web-streams` | 290.40 | 288.50 | 3.44 | 11,351 |
| `stream-json` | 1000.93 | 1003.73 | 1.00 | 11,351 |

### 5. Nested wildcard (`$[*].payload.commits[*].author.email`, 10,109 matches)

| Parser | Avg (ms) | Median (ms) | Ops/sec | Matches |
|---|---|---|---|---|
| **Piffero (stream)** | **292.13** | **293.79** | **3.42** | 10,109 |
| **Piffero (string)** | **292.60** | **292.60** | **3.42** | 10,109 |
| `json-web-streams` | 304.73 | 304.20 | 3.28 | 10,109 |
| `@sapientpro/json-stream` | 334.12 | 332.98 | 2.99 | 10,109 |
| `stream-json` | 1011.43 | 1010.01 | 0.99 | 10,109 |

### 6. Recursive descent (`$..user.login`, 4,272 matches)

| Parser | Avg (ms) | Median (ms) | Ops/sec | Matches |
|---|---|---|---|---|
| **Piffero (string)** | **489.70** | **490.46** | **2.04** | 4,272 |
| **Piffero (stream)** | **505.31** | **507.09** | **1.98** | 4,272 |
| `@sapientpro/json-stream` | 554.18 | 552.08 | 1.80 | 4,272 |
| `stream-json` | 980.58 | 975.86 | 1.02 | 4,272 |
| `json-web-streams` | N/A | N/A | N/A | N/A (`..` unsupported) |

### 7. Existence filter (`$[?(@.payload.issue)].payload.issue.number`, 1,389 matches)

| Parser | Avg (ms) | Median (ms) | Ops/sec | Matches |
|---|---|---|---|---|
| **Piffero (string)** | **294.31** | **294.06** | **3.40** | 1,389 |
| Piffero (stream) | 301.43 | 302.30 | 3.32 | 1,389 |
| `@sapientpro/json-stream` | N/A | N/A | N/A | N/A (filters unsupported) |
| `stream-json` | N/A | N/A | N/A | N/A (no JSONPath filter engine) |
| `json-web-streams` | N/A | N/A | N/A | N/A (filters unsupported) |

## Key Takeaways

- **Fastest in 5 of 7 scenarios**: Piffero wins on early-exit (`0.63 ms`), shallow wildcards (`258.44 ms`), nested wildcards (`292.13 ms`), recursive descent (`489.70 ms`), and existence filters (`294.31 ms`)—even while outputting serialized JSON and paying a `JSON.parse()` verification step in the harness.
- **Vs `stream-json`**: Piffero is **~1.2x–12.4x faster** across every single scenario (`0.63 ms` vs `7.81 ms` on early-exit, `106.31 ms` vs `378.09 ms` on mid-file, `258.44 ms` vs `1000.93 ms` on shallow wildcards, `292.13 ms` vs `1011.43 ms` on nested wildcards, and `489.70 ms` vs `980.58 ms` on recursive descent).
- **Vs `@sapientpro/json-stream` & `json-web-streams`**: Piffero now outpaces both on shallow wildcards (`258.44 ms` vs `279.07 ms` / `290.40 ms`), nested wildcards (`292.13 ms` vs `334.12 ms` / `304.73 ms`), and recursive descent (`489.70 ms` vs `554.18 ms`), while nearly matching `@sapientpro/json-stream` on mid-file lookups (`106.31 ms` vs `96.50 ms`). Additionally, **only Piffero** supports JSONPath filters `?()`, array slices, unions, negative indexes, automatic early termination, and direct JSON pass-through streaming (`[...]`).
- Verified in Jasmine parity suite: [`streamingParsersParitySpec.ts`](../../spec/piffero/streamingParsersParitySpec.ts).
