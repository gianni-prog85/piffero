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
- **Automatic early stream termination**: Destroys the upstream stream immediately once deterministic queries (e.g., `$.[1].payload`, `$.items[0:3]`) complete—delivering up to **~10x–12x** faster early-file extraction than Oboe and `@streamparser/json`.
- **Backpressure-aware JSON pass-through**: `Piffero.findByPath()` emits a chunked, backpressure-aware Node.js `Readable` stream containing a valid JSON array (`[...]`), ready to `.pipe(res)` directly over HTTP or into files without extra `JSON.stringify` overhead.
- **Complete JSONPath syntax**: Supports recursive descent (`..`), wildcards (`*`), array slices (`[start:end:step]`, negative indexes), unions (`[,]`), compound filter expressions (`?()` with `&&`, `||`, `!`, comparisons, existence checks), and script expressions (`(@.length-1)`)—capabilities missing from basic path-prefix parsers like `@streamparser/json`.
- **Flexible APIs**: Use `findByPath` (Stream), `findAsString` (callback), or `findAsPromise` (`async`/`await`) with clear separation between invalid JSONPath errors (`PifferoJsonPathError`) and malformed JSON stream errors (`PifferoError`).
- **Proven speed**: Faster than both Oboe and `@streamparser/json` on early-exit lookups, mid/end-file lookups, and selective wildcards on 38 MB JSON payloads (see [PERFORMANCE](#performance)).

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

```bash
npm run build                    # Compile TypeScript to ./dist
npm test                         # Run Jasmine test suite
npm run benchmark                # Run Benchmark.Suite (Piffero vs Oboe vs @streamparser/json vs jsonpath-plus)
npm run benchmark:compare        # Run extended 9-scenario comparison (Piffero vs Oboe vs @streamparser/json vs jsonpath-plus)
node benchmarking/compare-oboe.js # Run 8-scenario Piffero vs Oboe suite (38 MB JSON)
```

## PERFORMANCE

Benchmarks compare **Piffero** against [Oboe](https://github.com/jimhigson/oboe.js), [@streamparser/json](https://www.npmjs.com/package/@streamparser/json) (`keepStack: false`), and [jsonpath-plus](https://www.npmjs.com/package/jsonpath-plus) (`readFile` + `JSON.parse` + `JSONPath`) on the 38 MB GitHub events dataset (`spec/jsonFiles/large-file.json`).

### Extended comparison (`npm run benchmark:compare`)

Scenario (matches extracted)                               | Piffero (stream)        | Piffero (string)        | Oboe                    | @streamparser/json     | jsonpath-plus (in-memory)
-----------------------------------------------------------|-------------------------|-------------------------|-------------------------|------------------------|--------------------------
Early file `$.[1].payload` (1)                             | 5.16 ms (193.68 ops/s)  | **1.05 ms** (950.58 ops/s) | 11.17 ms (89.49 ops/s)  | 14.33 ms (69.80 ops/s) | 506.67 ms (1.97 ops/s)
Mid file `$.[5000].payload` (1)                            | **152.39 ms** (6.56 ops/s) | 154.78 ms (6.46 ops/s) | 456.73 ms (2.19 ops/s)  | 208.64 ms (4.79 ops/s) | 192.52 ms (5.19 ops/s)
End file `$.[11350]...received_events_url` (1)             | 326.92 ms (3.06 ops/s)  | 307.37 ms (3.25 ops/s)  | 641.68 ms (1.56 ops/s)  | 484.39 ms (2.06 ops/s) | **192.57 ms** (5.19 ops/s)
Root array elements `$[*]` (11,351)                        | 782.44 ms (1.28 ops/s)  | 872.91 ms (1.15 ops/s)  | 644.34 ms (1.55 ops/s)  | 404.21 ms (2.47 ops/s) | **200.57 ms** (4.99 ops/s)
Wildcard shallow `$[*].actor.login` (11,351)               | 414.60 ms (2.41 ops/s)  | 420.86 ms (2.38 ops/s)  | 673.17 ms (1.49 ops/s)  | 476.42 ms (2.10 ops/s) | **232.16 ms** (4.31 ops/s)
Nested wildcard `$[*].payload.commits[*].author.email` (10,109) | **447.17 ms** (2.24 ops/s) | 480.17 ms (2.08 ops/s) | 607.29 ms (1.65 ops/s) | 496.08 ms (2.02 ops/s) | 507.93 ms (1.97 ops/s)
Recursive descent `$..user.login` (4,272)                  | 484.20 ms (2.07 ops/s)  | 442.42 ms (2.26 ops/s)  | 610.31 ms (1.64 ops/s)  | N/A (unsupported)      | **291.56 ms** (3.43 ops/s)
Recursive + wildcard `$..commits[*].sha` (10,109)          | 492.12 ms (2.03 ops/s)  | 465.11 ms (2.15 ops/s)  | 664.31 ms (1.51 ops/s)  | N/A (unsupported)      | **344.00 ms** (2.91 ops/s)
Existence filter vs duck-typing (1,389)                    | 678.07 ms (1.47 ops/s)  | 644.61 ms (1.55 ops/s)  | 611.49 ms (1.64 ops/s)  | N/A (unsupported)      | **285.41 ms** (3.50 ops/s)

- **Streaming vs. in-memory (`jsonpath-plus`)**: `jsonpath-plus` must read and `JSON.parse()` the entire 38 MB document into RAM before evaluating a query. On early-file queries (`[1].payload`), Piffero is **~480x faster** (`1.05 ms` vs `506.67 ms`), and also outperforms `jsonpath-plus` on mid-file queries (`[5000].payload`) and nested wildcards (`$[*].payload.commits[*].author.email`)—while keeping memory bounded even on files larger than RAM.
- **Streaming vs. streaming (`Oboe` and `@streamparser/json`)**: Piffero outperforms both Oboe and `@streamparser/json` on early-exit queries, mid/end-file lookups, and selective wildcards (even while the benchmark parses Piffero's JSON string output back with `JSON.parse`).
- When extracting every full 38 MB root object (`$[*]`), `@streamparser/json` and `jsonpath-plus` are faster in this harness because they return JS objects directly without Piffero's JSON serialization + `JSON.parse` round-trip.
- Unlike `@streamparser/json` (whose `paths` option supports only `$`, property segments, and `*`), Piffero natively supports recursive descent (`..`), filters (`?()`), slices, unions, and script expressions—with full output parity against `jsonpath-plus`, plus safe null-tolerant traversal of missing intermediate properties in filters (where `jsonpath-plus` throws `TypeError`).

### Feature comparison

| Capability | Piffero | Oboe | @streamparser/json | jsonpath-plus |
|---|---|---|---|---|
| Streaming (files larger than RAM) | ✅ | ✅ | ✅ | ❌ (full `JSON.parse` in RAM) |
| Zero runtime dependencies | ✅ | ✅ | ✅ | ❌ |
| Node.js `Readable` stream output + backpressure | ✅ (`findByPath`) | ❌ (callback events) | ❌ (`@streamparser/json-node` wrapper needed) | ❌ |
| Direct JSON stream pass-through (no JS object alloc for unmatched branches) | ✅ | ❌ | ❌ | ❌ |
| Automatic early stream termination on deterministic queries | ✅ | Manual (`this.abort()`) | Manual (`stream.destroy()`) | ❌ |
| Child, array index, & wildcard (`*`) | ✅ | ✅ | ✅ | ✅ |
| Recursive descent (`..`) | ✅ | ✅ | ❌ | ✅ |
| Array slices (`[start:end:step]`), negative indexes, unions (`[,]`) | ✅ | Partial | ❌ | ✅ |
| Compound filters (`?()`) & script expressions (`()`) | ✅ | Duck-typing `{prop}` only | ❌ | ✅ |
| Safe missing intermediate property access in filters | ✅ | N/A | N/A | ❌ (throws `TypeError`) |
| Built-in TypeScript declarations | ✅ | ❌ (DefinitelyTyped) | ✅ | ✅ |

## Other tools
* Piffero is built on [Clarinet](https://github.com/dscape/clarinet)
* You can try [Oboe](https://github.com/jimhigson/oboe.js)
* You can try [@streamparser/json](https://www.npmjs.com/package/@streamparser/json)
* You can try [jsonpath-plus](https://www.npmjs.com/package/jsonpath-plus)
* You can also try [JSONPath Online Evaluator](https://jsonpath.com/)

enjoy Piffero!!
