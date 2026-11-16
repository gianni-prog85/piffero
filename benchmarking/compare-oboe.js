/**
 * Extended Piffero vs Oboe benchmark suite on 200 MiB JSON dataset
 * RUN: node benchmarking/compare-oboe.js
 */
const fs = require("fs");
const { performance } = require("perf_hooks");

const oboe = require("./oboe-node.js");
const { Piffero } = require("../dist/index.js");
const { ensure200MbDataset } = require("./dataset-200mb.js");

const DATASET = ensure200MbDataset();
const JSON_FILE = DATASET.filePath;

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

function runOboe(oboePattern, abortOnFirst) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    let count = 0;
    const inst = oboe(fs.createReadStream(JSON_FILE));
    inst.node(oboePattern, function () {
      count++;
      if (abortOnFirst) {
        this.abort();
        resolve({ ms: performance.now() - start, count });
      }
    });
    inst.done(() => {
      if (!abortOnFirst) {
        resolve({ ms: performance.now() - start, count });
      }
    });
    inst.fail((err) => reject(err));
  });
}

async function bench(label, fn, runs) {
  await fn(); // warmup
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
  console.log(
    `Dataset ${JSON_FILE}: ${(DATASET.bytesWritten / (1024 * 1024)).toFixed(2)} MiB (${DATASET.totalElements} elements)`
  );
  const midIdx = DATASET.midIdx;
  const endIdx = DATASET.endIdx;

  const cases = [
    {
      name: "1. Early file ([1].payload)",
      piffero: "$.[1].payload",
      oboe: "![1].payload",
      abortOnFirst: true,
      runs: 5,
    },
    {
      name: `2. Mid file ([${midIdx}].payload)`,
      piffero: `$.[${midIdx}].payload`,
      oboe: `![${midIdx}].payload`,
      abortOnFirst: true,
      runs: 2,
    },
    {
      name: `3. End file ([${endIdx}].payload.issue.user.received_events_url)`,
      piffero: `$.[${endIdx}].payload.issue.user.received_events_url`,
      oboe: `![${endIdx}].payload.issue.user.received_events_url`,
      abortOnFirst: true,
      runs: 2,
    },
    {
      name: "4. Wildcard shallow ($[*].actor.login)",
      piffero: "$[*].actor.login",
      oboe: "![*].actor.login",
      abortOnFirst: false,
      runs: 2,
    },
    {
      name: "5. Nested wildcard ($[*].payload.commits[*].author.email)",
      piffero: "$[*].payload.commits[*].author.email",
      oboe: "![*].payload.commits[*].author.email",
      abortOnFirst: false,
      runs: 2,
    },
    {
      name: "6. Recursive descent + child ($..user.login)",
      piffero: "$..user.login",
      oboe: "..user.login",
      abortOnFirst: false,
      runs: 2,
    },
    {
      name: "7. Recursive descent + wildcard ($..commits[*].sha)",
      piffero: "$..commits[*].sha",
      oboe: "..commits[*].sha",
      abortOnFirst: false,
      runs: 2,
    },
    {
      name: "8. Existence filter vs Oboe duck-typing ($[?(@.payload.issue)].payload.issue.number)",
      piffero: "$[?(@.payload.issue)].payload.issue.number",
      oboe: "![*].payload{issue}.issue.number",
      abortOnFirst: false,
      runs: 2,
    },
  ];

  for (const c of cases) {
    const pStream = await bench("Piffero (stream)", () => runPifferoStream(c.piffero), c.runs);
    const pString = await bench("Piffero (string)", () => runPifferoString(c.piffero), c.runs);
    const ob = await bench("Oboe", () => runOboe(c.oboe, c.abortOnFirst), c.runs);
    console.log(`\n=== ${c.name} ===`);
    console.table([pStream, pString, ob]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
