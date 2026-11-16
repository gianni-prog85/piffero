/**
 * Benchmark comparison on 38MB spec/jsonFiles/large-file.json:
 * Piffero vs @sapientpro/json-stream vs stream-json vs json-web-streams
 *
 * RUN: node benchmarking/compare-streaming.js
 */
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { performance } = require("perf_hooks");

const { createParser, createDecodedInput } = require("@sapientpro/json-stream");
const { chain } = require("stream-chain");
const { parser: streamJsonParser } = require("stream-json");
const { pick } = require("stream-json/filters/pick.js");
const { streamArray } = require("stream-json/streamers/stream-array.js");
const { streamValues } = require("stream-json/streamers/stream-values.js");
const { JSONParseStream } = require("json-web-streams");
const { Piffero } = require("../dist/index.js");

const JSON_FILE = path.join(__dirname, "../spec/jsonFiles/large-file.json");

function runPifferoStream(jsonPath) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const chunks = [];
    const s = Piffero.findByPath(fs.createReadStream(JSON_FILE), jsonPath);
    s.on("data", (c) => chunks.push(c));
    s.on("end", () => {
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      resolve({ ms: performance.now() - start, count: parsed.length });
    });
    s.on("error", reject);
  });
}

function runPifferoString(jsonPath) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    Piffero.findAsString(
      (res, err) => {
        if (err) return reject(err);
        const parsed = JSON.parse(res);
        resolve({ ms: performance.now() - start, count: parsed.length });
      },
      fs.createReadStream(JSON_FILE),
      jsonPath
    );
  });
}

function runSapientPro(jsonPath, earlyStop = false) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    let count = 0;
    let settled = false;
    const p = createParser();
    const s = fs.createReadStream(JSON_FILE);

    p.onValue(jsonPath, () => {
      count++;
      if (earlyStop && !settled) {
        settled = true;
        s.destroy();
        p.destroy();
        resolve({ ms: performance.now() - start, count });
      }
    });

    const input = createDecodedInput(p);
    s.on("data", (chunk) => {
      if (!settled) input.write(chunk);
    });
    s.on("end", () => {
      if (!settled) {
        settled = true;
        input.end();
        resolve({ ms: performance.now() - start, count });
      }
    });
    s.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

function runStreamJson(filter, useStreamArray = false, once = false) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    let count = 0;
    let settled = false;
    const input = fs.createReadStream(JSON_FILE);
    const stages = useStreamArray
      ? [input, streamJsonParser(), streamArray()]
      : [input, streamJsonParser(), pick({ filter, once }), streamValues()];
    const pipeline = chain(stages);

    pipeline.on("data", () => {
      count++;
      if (once && !settled) {
        settled = true;
        input.destroy();
        pipeline.destroy();
        resolve({ ms: performance.now() - start, count });
      }
    });
    pipeline.on("end", () => {
      if (!settled) {
        settled = true;
        resolve({ ms: performance.now() - start, count });
      }
    });
    pipeline.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

async function runJsonWebStreams(jsonPath) {
  const start = performance.now();
  let count = 0;
  const webStream = Readable.toWeb(fs.createReadStream(JSON_FILE))
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new JSONParseStream([jsonPath]));

  for await (const _item of webStream) {
    count++;
  }
  return { ms: performance.now() - start, count };
}

async function bench(label, fn, runs) {
  await fn();
  const times = [];
  let count = 0;
  for (let i = 0; i < runs; i++) {
    const r = await fn();
    times.push(r.ms);
    count = r.count;
  }
  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const median = times[Math.floor(times.length / 2)];
  return {
    label,
    avgMs: Number(avg.toFixed(2)),
    medianMs: Number(median.toFixed(2)),
    opsSec: Number((1000 / avg).toFixed(2)),
    matches: count,
  };
}

function na(label) {
  return {
    label,
    avgMs: "N/A",
    medianMs: "N/A",
    opsSec: "N/A",
    matches: "N/A (unsupported)",
  };
}

async function main() {
  const cases = [
    {
      name: "1. Early file ([1].payload)",
      piffero: "$.[1].payload",
      sapient: { path: "$[1].payload", earlyStop: true },
      sj: { filter: "1.payload", useArray: false, once: true },
      jws: null,
      runs: 5,
    },
    {
      name: "2. Mid file ([5000].payload)",
      piffero: "$.[5000].payload",
      sapient: { path: "$[5000].payload", earlyStop: true },
      sj: { filter: "5000.payload", useArray: false, once: true },
      jws: null,
      runs: 3,
    },
    {
      name: "3. Root array elements ($[*])",
      piffero: "$[*]",
      sapient: { path: "$[*]", earlyStop: false },
      sj: { filter: null, useArray: true, once: false },
      jws: "$[*]",
      runs: 3,
    },
    {
      name: "4. Wildcard shallow ($[*].actor.login)",
      piffero: "$[*].actor.login",
      sapient: { path: "$[*].actor.login", earlyStop: false },
      sj: { filter: /^\d+\.actor\.login$/, useArray: false, once: false },
      jws: "$[*].actor.login",
      runs: 3,
    },
    {
      name: "5. Nested wildcard ($[*].payload.commits[*].author.email)",
      piffero: "$[*].payload.commits[*].author.email",
      sapient: { path: "$[*].payload.commits[*].author.email", earlyStop: false },
      sj: {
        filter: /^\d+\.payload\.commits\.\d+\.author\.email$/,
        useArray: false,
        once: false,
      },
      jws: "$[*].payload.commits[*].author.email",
      runs: 3,
    },
    {
      name: "6. Recursive descent ($..user.login)",
      piffero: "$..user.login",
      sapient: { path: "$..user.login", earlyStop: false },
      sj: { filter: /(?:^|\.)user\.login$/, useArray: false, once: false },
      jws: null,
      runs: 3,
    },
    {
      name: "7. Existence filter ($[?(@.payload.issue)].payload.issue.number)",
      piffero: "$[?(@.payload.issue)].payload.issue.number",
      sapient: null,
      sj: null,
      jws: null,
      runs: 3,
    },
  ];

  for (const c of cases) {
    const rows = [];
    rows.push(
      await bench("Piffero (stream)", () => runPifferoStream(c.piffero), c.runs)
    );
    rows.push(
      await bench("Piffero (string)", () => runPifferoString(c.piffero), c.runs)
    );
    rows.push(
      c.sapient
        ? await bench(
            "@sapientpro/json-stream",
            () => runSapientPro(c.sapient.path, c.sapient.earlyStop),
            c.runs
          )
        : na("@sapientpro/json-stream")
    );
    rows.push(
      c.sj
        ? await bench(
            "stream-json",
            () => runStreamJson(c.sj.filter, c.sj.useArray, c.sj.once),
            c.runs
          )
        : na("stream-json")
    );
    rows.push(
      c.jws
        ? await bench("json-web-streams", () => runJsonWebStreams(c.jws), c.runs)
        : na("json-web-streams")
    );

    console.log(`\n=== ${c.name} ===`);
    console.table(rows);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
