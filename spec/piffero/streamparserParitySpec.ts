import * as fs from "fs";
import { Piffero } from "../../src/piffero";

const oboe = require("../../benchmarking/oboe-node.js");
const { JSONParser, TokenParserError } = require("@streamparser/json");

function collectOboe(filePath: string, pattern: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const matches: any[] = [];
    oboe(fs.createReadStream(filePath))
      .node(pattern, (val: any) => {
        matches.push(val);
      })
      .done(() => resolve(matches))
      .fail(reject);
  });
}

function collectStreamParser(filePath: string, paths: string[]): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const matches: any[] = [];
    const parser = new JSONParser({ paths, keepStack: false });
    let settled = false;

    parser.onValue = ({ value }: { value: any }) => {
      matches.push(value);
    };
    parser.onError = (err: Error) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };
    parser.onEnd = () => {
      if (!settled) {
        settled = true;
        resolve(matches);
      }
    };

    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk: Buffer) => {
      if (!settled) {
        parser.write(chunk);
      }
    });
    stream.on("end", () => {
      if (!settled && !parser.isEnded) {
        parser.end();
      }
    });
    stream.on("error", (err: Error) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

describe("Piffero vs Oboe vs @streamparser/json parity", function () {
  const sharedCases: Array<{
    name: string;
    file: string;
    piffero: string;
    oboe: string;
    streamparser: string[];
  }> = [
    {
      name: "property selector ($.array)",
      file: "spec/jsonFiles/test.json",
      piffero: "$.array",
      oboe: "!.array",
      streamparser: ["$.array"],
    },
    {
      name: "array element selector ($.phoneNumbers[1])",
      file: "spec/jsonFiles/john-doe.json",
      piffero: "$.phoneNumbers[1]",
      oboe: "!.phoneNumbers[1]",
      streamparser: ["$.phoneNumbers.1"],
    },
    {
      name: "root wildcard ($.*)",
      file: "spec/jsonFiles/test.json",
      piffero: "$.*",
      oboe: "!.*",
      streamparser: ["$.*"],
    },
    {
      name: "root wildcard on complex object ($.*)",
      file: "spec/jsonFiles/john-doe.json",
      piffero: "$.*",
      oboe: "!.*",
      streamparser: ["$.*"],
    },
    {
      name: "array wildcard property ($.phoneNumbers[*].number)",
      file: "spec/jsonFiles/john-doe.json",
      piffero: "$.phoneNumbers[*].number",
      oboe: "!.phoneNumbers[*].number",
      streamparser: ["$.phoneNumbers.*.number"],
    },
    {
      name: "array index property ($[1].tags)",
      file: "spec/jsonFiles/large.json",
      piffero: "$[1].tags",
      oboe: "![1].tags",
      streamparser: ["$.1.tags"],
    },
    {
      name: "nested array index ($[2].tags[1])",
      file: "spec/jsonFiles/large.json",
      piffero: "$[2].tags[1]",
      oboe: "![2].tags[1]",
      streamparser: ["$.2.tags.1"],
    },
    {
      name: "nested wildcard ($[*].tags[*])",
      file: "spec/jsonFiles/large.json",
      piffero: "$[*].tags[*]",
      oboe: "![*].tags[*]",
      streamparser: ["$.*.tags.*"],
    },
  ];

  for (const tc of sharedCases) {
    it(`matches Oboe and @streamparser/json output for ${tc.name}`, async function () {
      const [pifferoRaw, oboeResults, spResults] = await Promise.all([
        Piffero.findAsPromise(fs.createReadStream(tc.file), tc.piffero),
        collectOboe(tc.file, tc.oboe),
        collectStreamParser(tc.file, tc.streamparser),
      ]);
      const pifferoResults = JSON.parse(pifferoRaw);
      expect(pifferoResults).toEqual(oboeResults);
      expect(pifferoResults).toEqual(spResults);
    });
  }

  it("matches @streamparser/json multiple paths for key union ($['firstName','lastName'])", async function () {
    const [pifferoRaw, spResults] = await Promise.all([
      Piffero.findAsPromise(
        fs.createReadStream("spec/jsonFiles/john-doe.json"),
        "$['firstName','lastName']"
      ),
      collectStreamParser("spec/jsonFiles/john-doe.json", [
        "$.firstName",
        "$.lastName",
      ]),
    ]);
    expect(JSON.parse(pifferoRaw)).toEqual(spResults);
  });

  it("supports recursive descent, filters, and slices that @streamparser/json paths do not support", async function () {
    expect(() => new JSONParser({ paths: ["$..number"] })).toThrowError(
      TokenParserError
    );

    const [descentRaw, filterRaw, sliceRaw] = await Promise.all([
      Piffero.findAsPromise(
        fs.createReadStream("spec/jsonFiles/john-doe.json"),
        "$..number"
      ),
      Piffero.findAsPromise(
        fs.createReadStream("spec/jsonFiles/john-doe.json"),
        "$.phoneNumbers[?(@.test === true)].number"
      ),
      Piffero.findAsPromise(
        fs.createReadStream("spec/jsonFiles/large.json"),
        "$[2].tags[1:3]"
      ),
    ]);

    expect(JSON.parse(descentRaw)).toEqual(["0123-4567-8888", "0123-4567-8910"]);
    expect(JSON.parse(filterRaw)).toEqual(["0123-4567-8910"]);
    expect(JSON.parse(sliceRaw)).toEqual(["fugiat", "ad"]);
  });
});
