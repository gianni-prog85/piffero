# PIFFERO  [![Build Status](https://travis-ci.com/gfiorentino/piffero.svg?branch=master)](https://travis-ci.com/github/gfiorentino/piffero) [![Coverage Status](https://coveralls.io/repos/github/gfiorentino/piffero/badge.svg?branch=master)](https://coveralls.io/github/gfiorentino/piffero?branch=master) [![NPM version](https://img.shields.io/npm/v/piffero.svg)](https://www.npmjs.com/package/piffero)
The ultimate streaming JSONPath parser for Node.js

Piffero is an open source SAX-like parser that operates directly on Node.js streams to extract parts of large JSON files without loading the entire document into memory.

Piffero can process JSON files larger than available RAM and return the matched values as a valid JSON array stream, string, or Promise—with early stream termination on deterministic queries and full Node.js stream backpressure support.

```
  ______________________________ .  ♪
=(____|_o_o_o_o_|_o_o_o_o_|*____| |   ♫
                                 '
```

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
npm run benchmark                # Run original Piffero vs Oboe benchmark
node benchmarking/compare-oboe.js # Run extended 8-scenario Piffero vs Oboe suite (38 MB JSON)
```

## PERFORMANCE

Benchmarks compare **Piffero** against [Oboe](https://github.com/jimhigson/oboe.js) on the 38 MB GitHub events dataset (`spec/jsonFiles/large-file.json`).

### Extended comparison (`node benchmarking/compare-oboe.js`)

Scenario (matches extracted)                               | Piffero (stream)        | Piffero (string)        | Oboe
-----------------------------------------------------------|-------------------------|-------------------------|------------------------
Early file `$.[1].payload` (1)                             | 3.80 ms (263.02 ops/s)  | 1.08 ms (929.88 ops/s)  | 12.51 ms (79.93 ops/s)
Mid file `$.[5000].payload` (1)                            | 193.19 ms median        | 194.36 ms (5.14 ops/s)  | 588.72 ms (1.70 ops/s)
End file `$.[11350]...received_events_url` (1)             | 433.18 ms (2.31 ops/s)  | 437.54 ms (2.29 ops/s)  | 813.93 ms (1.23 ops/s)
Wildcard `$[*].actor.login` (11,351)                       | 581.17 ms (1.72 ops/s)  | 589.32 ms (1.70 ops/s)  | 835.33 ms (1.20 ops/s)
Nested wildcard `$[*].payload.commits[*].author.email` (10,109) | 573.24 ms (1.74 ops/s) | 588.95 ms (1.70 ops/s) | 825.01 ms (1.21 ops/s)
Recursive descent `$..user.login` (4,272)                  | 599.27 ms (1.67 ops/s)  | 610.82 ms (1.64 ops/s)  | 828.23 ms (1.21 ops/s)
Recursive + wildcard `$..commits[*].sha` (10,109)          | 610.04 ms (1.64 ops/s)  | 633.24 ms (1.58 ops/s)  | 812.64 ms (1.23 ops/s)
Existence filter vs duck-typing (1,389)                    | 806.59 ms (1.24 ops/s)  | 809.36 ms (1.24 ops/s)  | 827.46 ms (1.21 ops/s)

Piffero is faster than Oboe across both full-file scans (wildcards, recursive descent, filters) and early-exit queries, where destroying the input stream early yields 3x–11x speedups.

## Other tools
* Piffero is built on [Clarinet](https://github.com/dscape/clarinet)
* You can try [Oboe](https://github.com/jimhigson/oboe.js)
* You can also try [JSONPath Online Evaluator](https://jsonpath.com/)

enjoy Piffero!!
