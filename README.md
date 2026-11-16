# PIFFERO  [![Build Status](https://travis-ci.com/gfiorentino/piffero.svg?branch=master)](https://travis-ci.com/github/gfiorentino/piffero) [![Coverage Status](https://coveralls.io/repos/github/gfiorentino/piffero/badge.svg?branch=master)](https://coveralls.io/github/gfiorentino/piffero?branch=master) [![NPM version](https://img.shields.io/npm/v/piffero.svg)](https://www.npmjs.com/package/piffero)
The ultimate streaming JSONPath parser for Node.js

Piffero is an open source SAX-like parser that operates directly on Node.js streams to extract parts of large JSON files without loading the entire document into memory.

Piffero can process JSON files larger than available RAM and return the matched values as a valid JSON array stream, string, or Promise—with early stream termination on deterministic queries and full Node.js stream backpressure support.

```
  ______________________________ .  ♪
=(____|_o_o_o_o_|_o_o_o_o_|*____| |   ♫
                                 '
```

## Why Piffero?

- **Zero runtime dependencies**: Lightweight and self-contained (`dependencies: {}`), with bundled TypeScript declarations (`.d.ts`).
- **Larger-than-RAM streaming**: Parses Node.js `Readable` streams token-by-token without loading the full JSON document or allocating JavaScript objects for unmatched branches.
- **Automatic early stream termination**: Destroys the upstream stream immediately once deterministic queries (e.g., `$.[1].payload`, `$.items[0:3]`) complete—delivering up to **~12x–24x** faster early-file extraction than Oboe and up to **~3,376x–7,358x** faster than in-memory `jsonpath-plus`.
- **Backpressure-aware JSON pass-through**: `Piffero.findByPath()` emits a chunked, backpressure-aware Node.js `Readable` stream containing a valid JSON array (`[...]`), ready to `.pipe(res)` directly over HTTP or into files without extra `JSON.stringify` overhead.
- **Complete JSONPath syntax**: Supports recursive descent (`..`), wildcards (`*`), array slices (`[start:end:step]`, negative indexes), unions (`[,]`), compound filter expressions (`?()` with `&&`, `||`, `!`, comparisons, existence checks), and script expressions (`(@.length-1)`)—capabilities missing from basic path-prefix parsers like `@streamparser/json`.
- **Flexible APIs**: Use `findByPath` (Stream), `findAsString` (callback), or `findAsPromise` (`async`/`await`) with clear separation between invalid JSONPath errors (`PifferoJsonPathError`) and malformed JSON stream errors (`PifferoError`).
- **Proven speed**: Outperforms `@sapientpro/json-stream`, `json-web-streams`, `Oboe`, `@streamparser/json`, `stream-json`, `bfj`, and in-memory `jsonpath-plus` across early-exit, point lookups, selective wildcards, and recursive descent over 200 MiB JSON payloads (see [PERFORMANCE](#performance)).

# Description

Piffero supports the JSONPath syntax described in [Stefan Goessner's post](http://goessner.net/articles/JsonPath/), including wildcards, recursive descent, slices, unions, compound filter expressions, and script expressions:

JSONPath           | Description                                                          | Implemented
-------------------|----------------------------------------------------------------------|------------
`$`                | The root object/element                                              | ✅
`@`                | The current object/element (objects, nested properties, primitives)  | ✅
`.`                | Child member operator                                                | ✅
`..`               | Recursive descendant operator; JSONPath borrows this syntax from E4X | ✅
`*`                | Wildcard matching all objects/elements regardless of their names     | ✅
`[]`               | Subscript operator (indexes, quoted keys, negative indexes)          | ✅
`[,]`              | Union operator for alternate names or array indices as a set         | ✅
`[start:end:step]` | Array slice operator borrowed from ES4 / Python                      | ✅
`?()`              | Filter expressions (`===`, `!==`, `==`, `!=`, `>`, `<`, `>=`, `<=`, `&&`, `||`, `!`, existence) | ✅
`()`               | Script expressions (static arithmetic and `@.length` expressions)     | ✅

See the [replit.com demo](https://replit.com/@nigrosimone/Piffero#index.js).

## Supported JSONPath Capabilities

| Feature | Examples | Notes |
|---|---|---|
| **Child & Bracket Keys** | `$.firstName`, `$['firstName']`, `$['name','surname']` | Supports nested objects and key unions |
| **Array Indexing & Slices** | `$.employees[1]`, `$[0,2]`, `$[0:10:2]`, `$[-2:]` | O(1) index/slice evaluation on streaming fast path |
| **Wildcard (`*`)** | `$.*`, `$.employees[*].name`, `$.employees[*].phoneNumbers[*].number` | Matches all properties of objects or all elements of arrays |
| **Recursive Descent (`..`)** | `$..number`, `$.employees..type`, `$..phoneNumbers[0]` | Depth-first pre-order traversal across arbitrary nesting |
| **Current Element (`@`) & Filters (`?()`)** | `$.scores[?(@ > 10)]`, `$.users[?(@.address.city==='Rome')].name`, `$.items[?(@.price >= 10 && @.inStock)]`, `$.books[?(@.isbn)]` | Safe nested property traversal, boolean logic (`&&`, `\|\|`, `!`), arithmetic, and existence checks |
| **Script Expressions (`()`)** | `$.employees[(1+1)]`, `$.employees[(@.length-1)].name` | Static index calculation and O(`k`) tail-buffered `@.length - k` evaluation |

> **Output format:** Piffero always produces a valid JSON array (`[...]`) containing all matched elements in document order, whether consumed as a stream, callback string, or Promise.

# Get Started

*Step 1*: install Piffero

```bash
npm i piffero
```

*Step 2*: use Piffero

Call one of the three static methods on `Piffero`:

- `Piffero.findByPath(inputStream: Readable, jsonPath?: string): Stream` — returns a `Readable` stream emitting the matched JSON array (backpressure-aware, chunked output).
- `Piffero.findAsString(callback: (result: any, err?: any) => void, inputStream: Readable, jsonPath?: string): void` — invokes `callback(result, err)` once matching completes.
- `Piffero.findAsPromise(inputStream: Readable, jsonPath?: string): Promise<string>` — resolves with the JSON string or rejects on error.

## Error Handling

- **Invalid JSONPath syntax**: `Piffero.findByPath`, `findAsString`, and `findAsPromise` synchronously throw `PifferoJsonPathError` (e.g., paths not starting with `$`, unmatched brackets, or malformed filter/script expressions).
- **Malformed JSON input**: wrapped in `PifferoError` and propagated via:
  - the `'error'` event on the returned stream (`findByPath`),
  - the second `err` argument of the callback (`findAsString`),
  - Promise rejection (`findAsPromise`).

## Examples

Below are examples based on `employees.json`:

#### employees.json
```json
{
   "employees":[
      {
         "name":"John",
         "surname":"Doe",
         "active":true,
         "address":{ "city":"Rome" },
         "phoneNumbers":[
            {
               "type":"iPhone",
               "number":"0123-4567-8888",
               "test":false
            },
            {
               "type":"home",
               "number":"0123-4567-8910",
               "test":true
            }
         ]
      },
      {
         "name":"Joe",
         "surname":"Black",
         "active":false,
         "address":{ "city":"Milan" },
         "phoneNumbers":[]
      }
   ]
}
```

### Example: Extract with `findByPath()`

Extract the second employee (`"Joe Black"`) as a stream:

```js
const { Piffero } = require('piffero');
const fs = require('fs');

const inputStream = fs.createReadStream('./employees.json');
const resultStream = Piffero.findByPath(inputStream, '$.employees[1]');

let resultString = '';
resultStream.on('data', chunk => { resultString += chunk.toString(); });
resultStream.on('end', () => console.log(resultString));
resultStream.on('error', err => console.error(err));
```
#### Console result
```json
[{"name":"Joe","surname":"Black","active":false,"address":{"city":"Milan"},"phoneNumbers":[]}]
```

### Example: Extract with `findAsString()` and `findAsPromise()`

```js
const { Piffero } = require('piffero');
const fs = require('fs');

// Callback style
Piffero.findAsString(
  (result, err) => console.log(result),
  fs.createReadStream('./employees.json'),
  '$.employees[0].phoneNumbers[1]'
);

// Promise / async-await style
async function run() {
  const result = await Piffero.findAsPromise(
    fs.createReadStream('./employees.json'),
    '$.employees[*].name'
  );
  console.log(result); // ["John","Joe"]
}
```

### Example: Advanced JSONPath Queries (`..`, `*`, `?()`, `@`, `()`)

```js
// Wildcard: extract all phone numbers across all employees
await Piffero.findAsPromise(fs.createReadStream('./employees.json'), '$.employees[*].phoneNumbers[*].number');
// => ["0123-4567-8888","0123-4567-8910"]

// Recursive descent: find every "number" property at any nesting depth
await Piffero.findAsPromise(fs.createReadStream('./employees.json'), '$..number');
// => ["0123-4567-8888","0123-4567-8910"]

// Compound filter with nested @ property access
await Piffero.findAsPromise(
  fs.createReadStream('./employees.json'),
  '$.employees[?(@.active === true && @.address.city === "Rome")].surname'
);
// => ["Doe"]

// Script expression with @.length: get the last employee's name
await Piffero.findAsPromise(fs.createReadStream('./employees.json'), '$.employees[(@.length-1)].name');
// => ["Joe"]
```

### Example: Express.js streaming endpoint with TypeScript

```ts
import * as fs from "fs";
import * as express from "express";
import { Piffero } from "piffero";

const app: express.Application = express();

app.get("/api/:jsonPath", (req, res) => {
  const jsonPath: string = req.params.jsonPath;
  const inputStream: fs.ReadStream = fs.createReadStream('./employees.json');
  const resultStream = Piffero.findByPath(inputStream, jsonPath);

  res.setHeader("Content-Type", "application/json");
  resultStream.pipe(res);
});

app.listen(3000, () => {
  console.log("Open your browser at: http://localhost:3000/api/$.employees[0].phoneNumbers[1]");
});
```

## Development & Benchmarking

All benchmark suites automatically generate and cache a **200 MiB** (`200.01 MiB` / `209.72 MB`, `62,683` elements) JSON dataset in `os.tmpdir()` from [`spec/jsonFiles/large-file.json`](./spec/jsonFiles/large-file.json) on first run:

```bash
npm run build                    # Compile TypeScript to ./dist
npm test                         # Run Jasmine test suite
npm run benchmark                # Benchmark.Suite on 200 MiB JSON (Piffero vs Oboe vs @streamparser/json vs jsonpath-plus)
npm run benchmark:compare        # 9-scenario 200 MiB comparison (Piffero vs Oboe vs @streamparser/json vs jsonpath-plus)
npm run benchmark:streaming      # 7-scenario 200 MiB comparison (Piffero vs @sapientpro/json-stream vs stream-json vs json-web-streams)
npm run benchmark:bfj            # 5-scenario 200 MiB comparison (Piffero vs bfj)
npm run benchmark:200mb          # 8-scenario 200 MiB scale comparison across all 7 libraries
```

## PERFORMANCE

Benchmarks run on the **200 MiB** GitHub events dataset (`200.01 MiB` / `209.72 MB`, `62,683` records generated from `spec/jsonFiles/large-file.json`) against 7 libraries (`@sapientpro/json-stream`, `json-web-streams`, `stream-json`, `@streamparser/json`, `Oboe`, `bfj`, and in-memory `jsonpath-plus`).

### Summary (200 MiB JSON)

| Workload | Best Piffero | Key Comparison |
|---|---|---|
| **Early-exit index (`$.[1].payload`)** | **0.44–0.98 ms** (`string`) | Fastest overall: ahead of `@sapientpro/json-stream` (`0.77–1.02 ms`), `@streamparser/json` (`0.93–10.24 ms`), **~7.9x** faster than `bfj` (`4.36 ms`), **~7x–10x** faster than `stream-json` (`3.05–5.18 ms`), **~12x–24x** faster than `Oboe` (`10.51–11.94 ms`), **~3,376x–7,358x** faster than in-memory `jsonpath-plus` (`3237.53–3308.25 ms`); `json-web-streams` unsupported |
| **Mid-file lookup (`$.[31341].payload`)** | **582.10–626.82 ms** (`string`) | Fastest overall: ahead of `@sapientpro/json-stream` (`624.34–653.92 ms`), **~2.6x–3.4x** faster than `jsonpath-plus` (`1568.75–2013.73 ms`), **~2.9x** faster than `@streamparser/json` (`1712.21–1751.00 ms`), **~3.8x** faster than `stream-json` (`2240.51–2353.51 ms`), **~5.2x–5.4x** faster than `Oboe` (`3095.61–3240.89 ms`), **~52.8x** faster than `bfj` (`30,760.45 ms`) |
| **End-of-file lookup (`$.[56754]...received_events_url`)** | **1007.26–1118.06 ms** (`string`) | Fastest overall: ahead of `@sapientpro/json-stream` (`1116.58 ms`), **~1.8x–2.0x** faster than `jsonpath-plus` (`1973.14–2036.98 ms`), **~2.8x–3.1x** faster than `@streamparser/json` (`3103.23–3182.61 ms`), **~3.8x–4.0x** faster than `stream-json` / `Oboe` (`3972.58–4302.49 ms`) |
| **Selective wildcards (`$[*].actor.login`, `$[*].payload.commits[*].author.email`)** | **1320.95–1424.71 ms** / **1491.72–1603.60 ms** | Fastest streaming parser on nested wildcards (`1491.72–1603.60 ms`): ahead of `json-web-streams` (`1647.89–1778.87 ms`), `@sapientpro/json-stream` (`1766.77–1788.61 ms`), `@streamparser/json` (`3539.04–3780.32 ms`), `Oboe` (`4248.27–4580.17 ms`), and `stream-json` (`5397.23–5463.27 ms`), while beating `jsonpath-plus` (`1571.89` / `1937.37 ms`) with bounded RAM |
| **Recursive descent (`$..user.login`, `$..login`)** | **2452.23–2702.94 ms** (`$..user.login`) | Fastest streaming parser overall: faster than `@sapientpro/json-stream` (`3009.94–3018.34 ms`), `Oboe` (`4115.83–4461.52 ms`), `stream-json` (`5362.21–5425.97 ms`), and **~22.8x** faster than `bfj` (`2591.42 ms` vs `59,125.34 ms` on `$..login`); `@streamparser/json` and `json-web-streams` unsupported |
| **Filters (`?()`), slices (`[start:end]`), unions, negative indexes** | **1578.08–1678.32 ms** (filters) | **Only streaming library with native full JSONPath support** (**~2.6x** faster than `Oboe` duck-typing at `4148.77–4369.64 ms`, with all other streaming parsers unsupported); tracks `jsonpath-plus` (`1406.57–1594.54 ms` in-memory) with bounded RAM |

### Full Reports & Detailed Matrices

- [200 MiB Scale Comparison (7 Libraries)](./docs/benchmarks/scale-200mb.md)
- [Streaming Parsers Comparison (`@sapientpro/json-stream`, `stream-json`, `json-web-streams`)](./docs/benchmarks/streaming-parsers.md)
- [Extended 9-Scenario Comparison (`Oboe`, `@streamparser/json`, `jsonpath-plus`)](./docs/benchmarks/general-comparison.md)
- [`Piffero vs bfj` Comparison](./docs/benchmarks/bfj-comparison.md)
- [Full 8-Library Feature & JSONPath Matrix](./docs/benchmarks/feature-matrix.md)

## Other tools
* Piffero is built on [Clarinet](https://github.com/dscape/clarinet)
* Compared libraries: [@sapientpro/json-stream](https://www.npmjs.com/package/@sapientpro/json-stream) · [stream-json](https://www.npmjs.com/package/stream-json) · [json-web-streams](https://www.npmjs.com/package/json-web-streams) · [@streamparser/json](https://www.npmjs.com/package/@streamparser/json) · [Oboe](https://github.com/jimhigson/oboe.js) · [bfj](https://www.npmjs.com/package/bfj) · [jsonpath-plus](https://www.npmjs.com/package/jsonpath-plus)
* You can also try [JSONPath Online Evaluator](https://jsonpath.com/)

enjoy Piffero!!

