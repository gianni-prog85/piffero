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
- **Proven speed**: Outperforms `Oboe`, `@streamparser/json`, `bfj`, `stream-json`, and in-memory `jsonpath-plus` on early-exit and targeted lookups over 38 MB JSON payloads (see [PERFORMANCE](#performance)).

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
npm run benchmark                # Benchmark.Suite (Piffero vs Oboe vs @streamparser/json vs jsonpath-plus)
npm run benchmark:compare        # 9-scenario comparison (Piffero vs Oboe vs @streamparser/json vs jsonpath-plus)
npm run benchmark:streaming      # 7-scenario comparison (Piffero vs @sapientpro/json-stream vs stream-json vs json-web-streams)
npm run benchmark:bfj            # 5-scenario comparison (Piffero vs bfj)
```

## PERFORMANCE

Benchmarks run on the 38 MB GitHub events dataset (`spec/jsonFiles/large-file.json`) against 7 libraries (`Oboe`, `@streamparser/json`, `@sapientpro/json-stream`, `stream-json`, `json-web-streams`, `bfj`, and in-memory `jsonpath-plus`).

### Summary

| Workload | Best Piffero | Key Comparison |
|---|---|---|
| **Early-exit index (`$.[1].payload`)** | **0.72 ms** (`string`) | Fastest overall: **~1.2x** faster than `@sapientpro/json-stream` (`0.85 ms`), **~6.3x** faster than `stream-json` (`4.57 ms`), **~5.7x–20x** faster than `bfj`/`Oboe`/`@streamparser/json`, **~480x–700x** faster than in-memory `jsonpath-plus` (`506.67 ms`); `json-web-streams` unsupported |
| **Mid-file lookup (`$.[5000].payload`)** | **151.84 ms** | **~1.9x** faster than `stream-json` (`371.11 ms`), **~27x** faster than `bfj` (`4156.29 ms`), faster than `Oboe`, `@streamparser/json`, and `jsonpath-plus` (only `@sapientpro/json-stream` is faster at `97.31 ms` via manual destroy) |
| **Selective wildcards (`$[*].payload.commits[*].author.email`)** | **447.17 ms** | Faster than `stream-json` (`996.00 ms`), `Oboe` (`607.29 ms`), `@streamparser/json` (`496.08 ms`), and `jsonpath-plus` (`507.93 ms`); `@sapientpro/json-stream` (`332.62 ms`) and `json-web-streams` (`307.38 ms`) are faster when emitting JS objects without filters |
| **Recursive descent (`$..user.login`)** | **442.42 ms** | Virtually tied with `@sapientpro/json-stream` (`551.23 ms` vs `571.86 ms` in same run), **~1.7x** faster than `stream-json` (`991.77 ms`), **~22x** faster than `bfj` (`$..login`); `@streamparser/json` and `json-web-streams` unsupported |
| **Filters (`?()`), slices (`[start:end]`), unions, negative indexes** | **644–786 ms** | **Only streaming library with native full JSONPath support** (all other tested streaming parsers either reject filters/slices/unions or lack JSONPath); matches `jsonpath-plus` output while keeping bounded RAM and safe missing-property evaluation |

### Full Reports & Detailed Matrices

- [Streaming Parsers Comparison (`@sapientpro/json-stream`, `stream-json`, `json-web-streams`)](./docs/benchmarks/streaming-parsers.md)
- [Extended 9-Scenario Comparison (`Oboe`, `@streamparser/json`, `jsonpath-plus`)](./docs/benchmarks/general-comparison.md)
- [`Piffero vs bfj` Comparison](./docs/benchmarks/bfj-comparison.md)
- [Full 8-Library Feature & JSONPath Matrix](./docs/benchmarks/feature-matrix.md)

## Other tools
* Piffero is built on [Clarinet](https://github.com/dscape/clarinet)
* Compared libraries: [@sapientpro/json-stream](https://www.npmjs.com/package/@sapientpro/json-stream) · [stream-json](https://www.npmjs.com/package/stream-json) · [json-web-streams](https://www.npmjs.com/package/json-web-streams) · [@streamparser/json](https://www.npmjs.com/package/@streamparser/json) · [Oboe](https://github.com/jimhigson/oboe.js) · [bfj](https://www.npmjs.com/package/bfj) · [jsonpath-plus](https://www.npmjs.com/package/jsonpath-plus)
* You can also try [JSONPath Online Evaluator](https://jsonpath.com/)

enjoy Piffero!!

