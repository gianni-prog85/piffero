import * as fs from "fs";
import { Readable } from "stream";
import { Piffero } from "../../src/piffero";

const {
  createParser,
  createDecodedInput,
} = require("@sapientpro/json-stream");
const { chain } = require("stream-chain");
const { parser: streamJsonParser } = require("stream-json");
const { pick } = require("stream-json/filters/pick.js");
const { streamValues } = require("stream-json/streamers/stream-values.js");
const { JSONParseStream } = require("json-web-streams");

function collectSapientPro(
  filePath: string,
  jsonPath: string
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const matches: any[] = [];
    const p = createParser();
    p.onValue(jsonPath, (val: any) => matches.push(val));
    const input = createDecodedInput(p);
    const s = fs.createReadStream(filePath);
    s.on("data", (chunk: Buffer) => {
      try {
        input.write(chunk);
      } catch (err) {
        reject(err);
      }
    });
    s.on("end", () => {
      try {
        input.end();
        resolve(matches);
      } catch (err) {
        reject(err);
      }
    });
    s.on("error", reject);
  });
}

function collectStreamJson(
  filePath: string,
  filter: string | RegExp
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const matches: any[] = [];
    const pipeline = chain([
      fs.createReadStream(filePath),
      streamJsonParser(),
      pick({ filter }),
      streamValues(),
    ]);
    pipeline.on("data", ({ value }: { value: any }) => matches.push(value));
    pipeline.on("end", () => resolve(matches));
    pipeline.on("error", reject);
  });
}

async function collectJsonWebStreams(
  filePath: string,
  jsonPath: string
): Promise<any[]> {
  const matches: any[] = [];
  const TextDecoderStreamCtor = (globalThis as any).TextDecoderStream;
  const webStream = (Readable as any)
    .toWeb(fs.createReadStream(filePath))
    .pipeThrough(new TextDecoderStreamCtor())
    .pipeThrough(new JSONParseStream([jsonPath]));

  for await (const chunk of webStream as AsyncIterable<{ value: any }>) {
    matches.push(chunk.value);
  }
  return matches;
}

describe("Piffero vs @sapientpro/json-stream vs stream-json vs json-web-streams parity", function () {
  it("matches all three parsers on property and wildcard selectors", async function () {
    const cases: Array<{
      file: string;
      piffero: string;
      sjFilter: string | RegExp;
    }> = [
      {
        file: "spec/jsonFiles/test.json",
        piffero: "$.array",
        sjFilter: "array",
      },
      {
        file: "spec/jsonFiles/test.json",
        piffero: "$.*",
        sjFilter: /^[^.]+$/,
      },
      {
        file: "spec/jsonFiles/john-doe.json",
        piffero: "$.phoneNumbers[*].number",
        sjFilter: /^phoneNumbers\.\d+\.number$/,
      },
      {
        file: "spec/jsonFiles/large.json",
        piffero: "$[*].tags[*]",
        sjFilter: /^\d+\.tags\.\d+$/,
      },
    ];

    for (const tc of cases) {
      const [pifferoRaw, sapientRes, sjRes, jwsRes] = await Promise.all([
        Piffero.findAsPromise(fs.createReadStream(tc.file), tc.piffero),
        collectSapientPro(tc.file, tc.piffero),
        collectStreamJson(tc.file, tc.sjFilter),
        collectJsonWebStreams(tc.file, tc.piffero),
      ]);
      const expected = JSON.parse(pifferoRaw);
      expect(sapientRes).toEqual(expected);
      expect(sjRes).toEqual(expected);
      expect(jwsRes).toEqual(expected);
    }
  });

  it("matches @sapientpro/json-stream and stream-json on array index selectors (unsupported in json-web-streams)", async function () {
    const cases: Array<{
      file: string;
      piffero: string;
      sjFilter: string;
    }> = [
      {
        file: "spec/jsonFiles/john-doe.json",
        piffero: "$.phoneNumbers[1]",
        sjFilter: "phoneNumbers.1",
      },
      {
        file: "spec/jsonFiles/large.json",
        piffero: "$[2].tags[1]",
        sjFilter: "2.tags.1",
      },
    ];

    for (const tc of cases) {
      const [pifferoRaw, sapientRes, sjRes] = await Promise.all([
        Piffero.findAsPromise(fs.createReadStream(tc.file), tc.piffero),
        collectSapientPro(tc.file, tc.piffero),
        collectStreamJson(tc.file, tc.sjFilter),
      ]);
      const expected = JSON.parse(pifferoRaw);
      expect(sapientRes).toEqual(expected);
      expect(sjRes).toEqual(expected);
      expect(() => new JSONParseStream([tc.piffero])).toThrow();
    }
  });

  it("matches @sapientpro/json-stream on recursive descent ($..number, $..type) where json-web-streams throws", async function () {
    const cases = [
      { file: "spec/jsonFiles/john-doe.json", path: "$..number" },
      { file: "spec/jsonFiles/john-doe.json", path: "$..type" },
      { file: "spec/jsonFiles/test.json", path: "$..a" },
    ];

    for (const tc of cases) {
      const [pifferoRaw, sapientRes] = await Promise.all([
        Piffero.findAsPromise(fs.createReadStream(tc.file), tc.path),
        collectSapientPro(tc.file, tc.path),
      ]);
      expect(JSON.parse(pifferoRaw)).toEqual(sapientRes);
      expect(() => new JSONParseStream([tc.path])).toThrow();
    }
  });

  it("supports filters, slices, unions, and negative indexes rejected by @sapientpro/json-stream and json-web-streams", async function () {
    const pSapient = createParser();
    const unsupportedPaths = [
      "$.phoneNumbers[?(@.test === true)].number",
      "$[2].tags[1:3]",
      "$['firstName','lastName']",
      "$.phoneNumbers[-1].number",
    ];

    for (const path of unsupportedPaths) {
      expect(() => pSapient.onValue(path, () => {})).toThrowError(SyntaxError);
      expect(() => new JSONParseStream([path])).toThrow();
    }

    const [filterRaw, sliceRaw, unionRaw, negRaw] = await Promise.all([
      Piffero.findAsPromise(
        fs.createReadStream("spec/jsonFiles/john-doe.json"),
        unsupportedPaths[0]
      ),
      Piffero.findAsPromise(
        fs.createReadStream("spec/jsonFiles/large.json"),
        unsupportedPaths[1]
      ),
      Piffero.findAsPromise(
        fs.createReadStream("spec/jsonFiles/john-doe.json"),
        unsupportedPaths[2]
      ),
      Piffero.findAsPromise(
        fs.createReadStream("spec/jsonFiles/john-doe.json"),
        unsupportedPaths[3]
      ),
    ]);

    expect(JSON.parse(filterRaw)).toEqual(["0123-4567-8910"]);
    expect(JSON.parse(sliceRaw)).toEqual(["fugiat", "ad"]);
    expect(JSON.parse(unionRaw)).toEqual(["John", "doe"]);
    expect(JSON.parse(negRaw)).toEqual(["0123-4567-8910"]);
  });
});
