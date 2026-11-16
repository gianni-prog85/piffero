import * as fs from "fs";
import { Piffero } from "../../src/piffero";

const oboe = require("../../benchmarking/oboe-node.js");

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

describe("Piffero vs Oboe parity", function () {
  const cases: Array<{ name: string; file: string; piffero: string; oboe: string }> = [
    {
      name: "root wildcard ($.* vs !.*)",
      file: "spec/jsonFiles/test.json",
      piffero: "$.*",
      oboe: "!.*",
    },
    {
      name: "array wildcard property ($.phoneNumbers[*].number vs !.phoneNumbers[*].number)",
      file: "spec/jsonFiles/john-doe.json",
      piffero: "$.phoneNumbers[*].number",
      oboe: "!.phoneNumbers[*].number",
    },
    {
      name: "recursive descent ($..type vs ..type)",
      file: "spec/jsonFiles/john-doe.json",
      piffero: "$..type",
      oboe: "..type",
    },
    {
      name: "recursive descent on nested arrays ($..a vs ..a)",
      file: "spec/jsonFiles/test.json",
      piffero: "$..a",
      oboe: "..a",
    },
    {
      name: "existence filter vs duck typing ($.array[?(@.b)] vs !.array[*]{b})",
      file: "spec/jsonFiles/test.json",
      piffero: "$.array[?(@.b)]",
      oboe: "!.array[*]{b}",
    },
    {
      name: "nested wildcard ($[*].tags[*])",
      file: "spec/jsonFiles/large.json",
      piffero: "$[*].tags[*]",
      oboe: "![*].tags[*]",
    },
  ];

  for (const tc of cases) {
    it(`matches Oboe output for ${tc.name}`, async function () {
      const [pifferoRaw, oboeResults] = await Promise.all([
        Piffero.findAsPromise(fs.createReadStream(tc.file), tc.piffero),
        collectOboe(tc.file, tc.oboe),
      ]);
      const pifferoResults = JSON.parse(pifferoRaw);
      expect(pifferoResults).toEqual(oboeResults);
    });
  }
});
