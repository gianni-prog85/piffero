/**
 * Piffero vs bfj benchmark suite on 38MB spec/jsonFiles/large-file.json
 * RUN: node benchmarking/compare-bfj.js
 */
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");

const bfj = require("bfj");
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

function runBfjMatch(selector, options, stopAfterNth) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    let count = 0;
    let settled = false;
    const input = fs.createReadStream(JSON_FILE);
    const out = bfj.match(input, selector, options);

    out.on("data", () => {
      count++;
      if (stopAfterNth && count >= stopAfterNth && !settled) {
        settled = true;
        input.destroy();
        out.destroy();
        resolve({ ms: performance.now() - start, count: 1 });
      }
    });
    out.on("end", () => {
      if (!settled) {
        settled = true;
        resolve({ ms: performance.now() - start, count });
      }
    });
    out.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    out.on("dataError", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

async function bench(label, fn, runs, skipWarmup = false) {
  if (!skipWarmup) {
    await fn();
  }
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

async function main() {
  const cases = [
    {
      name: "1. Early file ([1].payload vs bfj predicate)",
      piffero: "$.[1].payload",
      pifferoRuns: 5,
      bfjSelector: (k, _v, d) => d === 2 && k === "payload",
      bfjOptions: { minDepth: 1 },
      bfjStopAfter: 2,
      bfjRuns: 5,
    },
    {
      name: "2. Mid file ([5000].payload vs bfj predicate)",
      piffero: "$.[5000].payload",
      pifferoRuns: 3,
      bfjSelector: (k, _v, d) => d === 2 && k === "payload",
      bfjOptions: { minDepth: 1 },
      bfjStopAfter: 5001,
      bfjRuns: 1,
      bfjSkipWarmup: true,
    },
    {
      name: "3. Root array elements ($[*] vs bfj depth-1 predicate)",
      piffero: "$[*]",
      pifferoRuns: 3,
      bfjSelector: (_k, _v, d) => d === 1,
      bfjOptions: {},
      bfjStopAfter: 0,
      bfjRuns: 1,
      bfjSkipWarmup: true,
    },
    {
      name: "4. Recursive key ($..login vs bfj key selector 'login')",
      piffero: "$..login",
      pifferoRuns: 3,
      bfjSelector: "login",
      bfjOptions: {},
      bfjStopAfter: 0,
      bfjRuns: 1,
      bfjSkipWarmup: true,
    },
    {
      name: "5. Existence filter ($[?(@.payload.issue)].payload.issue.number)",
      piffero: "$[?(@.payload.issue)].payload.issue.number",
      pifferoRuns: 3,
      bfjSelector: null,
    },
  ];

  for (const c of cases) {
    const pStream = await bench("Piffero (stream)", () => runPifferoStream(c.piffero), c.pifferoRuns);
    const pString = await bench("Piffero (string)", () => runPifferoString(c.piffero), c.pifferoRuns);
    const bfjRes = c.bfjSelector
      ? await bench(
          "bfj.match",
          () => runBfjMatch(c.bfjSelector, c.bfjOptions, c.bfjStopAfter),
          c.bfjRuns,
          c.bfjSkipWarmup
        )
      : {
          label: "bfj.match",
          avgMs: "N/A",
          medianMs: "N/A",
          opsSec: "N/A",
          matches: "N/A (unsupported)",
        };
    console.log(`\n=== ${c.name} ===`);
    console.table([pStream, pString, bfjRes]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
