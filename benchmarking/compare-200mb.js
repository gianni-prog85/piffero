/**
 * Large-scale 200 MiB benchmark comparison across 7 parsers.
 * Generates a 200 MiB JSON file in os.tmpdir() from spec/jsonFiles/large-file.json on first run.
 *
 * RUN: node benchmarking/compare-200mb.js
 */
const fs = require("fs");
const os = require("os");
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
const oboe = require("./oboe-node.js");
const { JSONParser } = require("@streamparser/json");
const { JSONPath } = require("jsonpath-plus");
const { Piffero } = require("../dist/index.js");

const { ensure200MbDataset } = require("./dataset-200mb.js");

const DATASET = ensure200MbDataset();
const OUT_FILE = DATASET.filePath;

function ensure200MbFile() {
  return {
    bytesWritten: DATASET.bytesWritten,
    totalElements: DATASET.totalElements,
    lastIssueIdx: DATASET.endIdx,
  };
}

function runPifferoStream(jsonPath) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const chunks = [];
    const s = Piffero.findByPath(fs.createReadStream(OUT_FILE), jsonPath);
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
      fs.createReadStream(OUT_FILE),
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
    const s = fs.createReadStream(OUT_FILE);

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
    const input = fs.createReadStream(OUT_FILE);
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
  const webStream = Readable.toWeb(fs.createReadStream(OUT_FILE))
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new JSONParseStream([jsonPath]));

  for await (const _item of webStream) {
    count++;
  }
  return { ms: performance.now() - start, count };
}

function runOboe(oboePattern, abortOnFirst) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    let count = 0;
    const inst = oboe(fs.createReadStream(OUT_FILE));
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

function runStreamParser(paths, abortOnFirst) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    let count = 0;
    let settled = false;
    const stream = fs.createReadStream(OUT_FILE);
    const parser = new JSONParser({ paths, keepStack: false });

    parser.onValue = () => {
      count++;
      if (abortOnFirst && !settled) {
        settled = true;
        stream.destroy();
        resolve({ ms: performance.now() - start, count });
      }
    };
    parser.onError = (err) => {
      if (!settled) {
        settled = true;
        stream.destroy();
        reject(err);
      }
    };
    parser.onEnd = () => {
      if (!settled) {
        settled = true;
        resolve({ ms: performance.now() - start, count });
      }
    };

    stream.on("data", (chunk) => {
      if (!settled) parser.write(chunk);
    });
    stream.on("end", () => {
      if (!settled && !parser.isEnded) parser.end();
    });
    stream.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

async function runJsonPathPlus(jsonPath) {
  const start = performance.now();
  const raw = await fs.promises.readFile(OUT_FILE, "utf8");
  const json = JSON.parse(raw);
  const res = JSONPath({ path: jsonPath, json });
  return { ms: performance.now() - start, count: res.length };
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
  const info = ensure200MbFile();
  console.log(
    `Dataset ${OUT_FILE}: ${(info.bytesWritten / (1024 * 1024)).toFixed(2)} MiB (${(info.bytesWritten / 1e6).toFixed(2)} MB), ${info.totalElements} elements, endIdx=${info.lastIssueIdx}`
  );

  const endIdx = info.lastIssueIdx;
  const midIdx = Math.floor(info.totalElements / 2);

  const cases = [
    {
      name: "1. Early file ($.[1].payload)",
      piffero: "$.[1].payload",
      sapient: { path: "$[1].payload", earlyStop: true },
      sj: { filter: "1.payload", useArray: false, once: true },
      jws: null,
      oboe: { pattern: "![1].payload", abort: true },
      sp: { paths: ["$.1.payload"], abort: true },
      jpp: "$[1].payload",
      runs: 5,
    },
    {
      name: `2. Mid file ($.[${midIdx}].payload)`,
      piffero: `$.[${midIdx}].payload`,
      sapient: { path: `$[${midIdx}].payload`, earlyStop: true },
      sj: { filter: `${midIdx}.payload`, useArray: false, once: true },
      jws: null,
      oboe: { pattern: `![${midIdx}].payload`, abort: true },
      sp: { paths: [`$.${midIdx}.payload`], abort: true },
      jpp: `$[${midIdx}].payload`,
      runs: 2,
    },
    {
      name: `3. End file ($.[${endIdx}].payload.issue.user.received_events_url)`,
      piffero: `$.[${endIdx}].payload.issue.user.received_events_url`,
      sapient: { path: `$[${endIdx}].payload.issue.user.received_events_url`, earlyStop: true },
      sj: { filter: `${endIdx}.payload.issue.user.received_events_url`, useArray: false, once: true },
      jws: null,
      oboe: { pattern: `![${endIdx}].payload.issue.user.received_events_url`, abort: true },
      sp: { paths: [`$.${endIdx}.payload.issue.user.received_events_url`], abort: true },
      jpp: `$[${endIdx}].payload.issue.user.received_events_url`,
      runs: 2,
    },
    {
      name: "4. Root array elements ($[*])",
      piffero: "$[*]",
      sapient: { path: "$[*]", earlyStop: false },
      sj: { filter: null, useArray: true, once: false },
      jws: "$[*]",
      oboe: { pattern: "![*]", abort: false },
      sp: { paths: ["$.*"], abort: false },
      jpp: "$[*]",
      runs: 2,
    },
    {
      name: "5. Wildcard shallow ($[*].actor.login)",
      piffero: "$[*].actor.login",
      sapient: { path: "$[*].actor.login", earlyStop: false },
      sj: { filter: /^\d+\.actor\.login$/, useArray: false, once: false },
      jws: "$[*].actor.login",
      oboe: { pattern: "![*].actor.login", abort: false },
      sp: { paths: ["$.*.actor.login"], abort: false },
      jpp: "$[*].actor.login",
      runs: 2,
    },
    {
      name: "6. Nested wildcard ($[*].payload.commits[*].author.email)",
      piffero: "$[*].payload.commits[*].author.email",
      sapient: { path: "$[*].payload.commits[*].author.email", earlyStop: false },
      sj: { filter: /^\d+\.payload\.commits\.\d+\.author\.email$/, useArray: false, once: false },
      jws: "$[*].payload.commits[*].author.email",
      oboe: { pattern: "![*].payload.commits[*].author.email", abort: false },
      sp: { paths: ["$.*.payload.commits.*.author.email"], abort: false },
      jpp: "$[*].payload.commits[*].author.email",
      runs: 2,
    },
    {
      name: "7. Recursive descent ($..user.login)",
      piffero: "$..user.login",
      sapient: { path: "$..user.login", earlyStop: false },
      sj: { filter: /(?:^|\.)user\.login$/, useArray: false, once: false },
      jws: null,
      oboe: { pattern: "..user.login", abort: false },
      sp: null,
      jpp: "$..user.login",
      runs: 2,
    },
    {
      name: "8. Existence filter ($[?(@.payload.issue)].payload.issue.number)",
      piffero: "$[?(@.payload.issue)].payload.issue.number",
      sapient: null,
      sj: null,
      jws: null,
      oboe: { pattern: "![*].payload{issue}.issue.number", abort: false },
      sp: null,
      jpp: "$[?(@.payload.issue)].payload.issue.number",
      runs: 2,
    },
    {
      name: "9. RFC 9535 filter without parens ($[?@.payload.issue].payload.issue.number)",
      piffero: "$[?@.payload.issue].payload.issue.number",
      sapient: null,
      sj: null,
      jws: null,
      oboe: { pattern: "![*].payload{issue}.issue.number", abort: false },
      sp: null,
      jpp: null,
      runs: 2,
    },
  ];

  for (const c of cases) {
    const rows = [];
    rows.push(await bench("Piffero (stream)", () => runPifferoStream(c.piffero), c.runs));
    rows.push(await bench("Piffero (string)", () => runPifferoString(c.piffero), c.runs));
    rows.push(
      c.sapient
        ? await bench("@sapientpro/json-stream", () => runSapientPro(c.sapient.path, c.sapient.earlyStop), c.runs)
        : na("@sapientpro/json-stream")
    );
    rows.push(
      c.sj
        ? await bench("stream-json", () => runStreamJson(c.sj.filter, c.sj.useArray, c.sj.once), c.runs)
        : na("stream-json")
    );
    rows.push(
      c.jws
        ? await bench("json-web-streams", () => runJsonWebStreams(c.jws), c.runs)
        : na("json-web-streams")
    );
    rows.push(
      c.sp
        ? await bench("@streamparser/json", () => runStreamParser(c.sp.paths, c.sp.abort), c.runs)
        : na("@streamparser/json")
    );
    rows.push(
      c.oboe
        ? await bench("Oboe", () => runOboe(c.oboe.pattern, c.oboe.abort), c.runs)
        : na("Oboe")
    );
    rows.push(
      c.jpp
        ? await bench("jsonpath-plus (in-memory)", () => runJsonPathPlus(c.jpp), c.runs)
        : na("jsonpath-plus (in-memory)")
    );
    console.log(`\n=== ${c.name} ===`);
    console.table(rows);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
