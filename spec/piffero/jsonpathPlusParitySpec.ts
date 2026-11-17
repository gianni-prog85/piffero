import * as fs from "fs";
import { Readable } from "stream";
import { Piffero } from "../../src/piffero";

const { JSONPath } = require("jsonpath-plus");

describe("Piffero vs jsonpath-plus parity", function () {
  const fileCases: Array<{ name: string; file: string; path: string }> = [
    { name: "root wildcard ($.*)", file: "spec/jsonFiles/test.json", path: "$.*" },
    { name: "property selector ($.array)", file: "spec/jsonFiles/test.json", path: "$.array" },
    { name: "recursive descent ($..a)", file: "spec/jsonFiles/test.json", path: "$..a" },
    { name: "existence filter ($.array[?(@.b)])", file: "spec/jsonFiles/test.json", path: "$.array[?(@.b)]" },
    { name: "complex object wildcard ($.*)", file: "spec/jsonFiles/john-doe.json", path: "$.*" },
    { name: "array wildcard property ($.phoneNumbers[*].number)", file: "spec/jsonFiles/john-doe.json", path: "$.phoneNumbers[*].number" },
    { name: "recursive descent ($..type)", file: "spec/jsonFiles/john-doe.json", path: "$..type" },
    { name: "boolean filter ($.phoneNumbers[?(@.test === true)].number)", file: "spec/jsonFiles/john-doe.json", path: "$.phoneNumbers[?(@.test === true)].number" },
    { name: "key union ($['firstName','lastName'])", file: "spec/jsonFiles/john-doe.json", path: "$['firstName','lastName']" },
    { name: "nested wildcard ($[*].tags[*])", file: "spec/jsonFiles/large.json", path: "$[*].tags[*]" },
    { name: "array index property ($[1].tags)", file: "spec/jsonFiles/large.json", path: "$[1].tags" },
    { name: "array slice ($[2].tags[1:3])", file: "spec/jsonFiles/large.json", path: "$[2].tags[1:3]" },
    { name: "array slice with step ($[2].tags[0:5:2])", file: "spec/jsonFiles/large.json", path: "$[2].tags[0:5:2]" },
    { name: "negative slice ($[2].tags[-2:])", file: "spec/jsonFiles/large.json", path: "$[2].tags[-2:]" },
    { name: "open-ended slice with step ($[2].tags[1::3])", file: "spec/jsonFiles/large.json", path: "$[2].tags[1::3]" },
    { name: "reverse slice ($[2].tags[::-1])", file: "spec/jsonFiles/large.json", path: "$[2].tags[::-1]" },
    { name: "zero-end slice ($[2].tags[1:0:3])", file: "spec/jsonFiles/large.json", path: "$[2].tags[1:0:3]" },
    { name: "script expression ($[2].tags[(@.length-1)])", file: "spec/jsonFiles/large.json", path: "$[2].tags[(@.length-1)]" },
    { name: "index union ($[2].tags[1,4])", file: "spec/jsonFiles/large.json", path: "$[2].tags[1,4]" },
  ];

  for (const tc of fileCases) {
    it(`matches jsonpath-plus output for ${tc.name}`, async function () {
      const json = JSON.parse(fs.readFileSync(tc.file, "utf8"));
      const pifferoRaw = await Piffero.findAsPromise(
        fs.createReadStream(tc.file),
        tc.path
      );
      const pifferoResults = JSON.parse(pifferoRaw);
      const jpResults = JSONPath({ path: tc.path, json });
      expect(pifferoResults).toEqual(jpResults);
    });
  }

  it("matches jsonpath-plus on compound filters and recursive descent filters", async function () {
    const data = {
      employees: [
        { name: "John", active: true, address: { city: "Rome" }, tags: ["dev", "ts"] },
        { name: "Joe", active: false, address: { city: "Milan" }, tags: ["ops"] },
        { name: "Anna", active: true, address: { city: "Turin" }, isbn: "978-3-16", tags: ["lead", "arch", "ts"] },
      ],
      scores: [5, 12, 8, 20, 15],
      root: { a: 1, child: { a: 1, val: "inner" }, val: "outer" },
    };

    const compoundPaths = [
      "$.scores[?(@ > 10)]",
      "$.employees[?(@.address.city === 'Rome')].name",
      "$.employees[?(@.active === true && !@.isbn)].name",
      "$.employees[?(@.tags[0] === 'lead' || @.tags.length === 2)].name",
      "$..[?(@.a === 1)].val",
    ];

    const payload = JSON.stringify(data);
    for (const p of compoundPaths) {
      const pifferoRaw = await Piffero.findAsPromise(Readable.from([payload]), p);
      const jpResults = JSONPath({ path: p, json: data });
      expect(JSON.parse(pifferoRaw)).toEqual(jpResults);
    }
  });

  it("safely handles missing intermediate properties in filter expressions without throwing", async function () {
    const data = {
      employees: [
        { name: "John", address: { city: "Rome" } },
        { name: "Anna" },
      ],
    };

    const path = "$.employees[?(@.address.city === 'Rome')].name";
    const pifferoRaw = await Piffero.findAsPromise(
      Readable.from([JSON.stringify(data)]),
      path
    );
    expect(JSON.parse(pifferoRaw)).toEqual(["John"]);
    expect(() => JSONPath({ path, json: data })).toThrow();
  });

  it("matches jsonpath-plus across RFC 9535 slice edge cases", async function () {
    const arr = ["a", "b", "c", "d", "e", "f", "g"];
    const slicePaths = [
      "$[1:3]",
      "$[5:]",
      "$[1:5:2]",
      "$[5:1:-2]",
      "$[::-1]",
      "$[0:0]",
      "$[1:5:0]",
      "$[:-4:-1]",
      "$[-3::-1]",
      "$[5:0:-2]",
    ];

    const payload = JSON.stringify(arr);
    for (const p of slicePaths) {
      const pifferoRaw = await Piffero.findAsPromise(Readable.from([payload]), p);
      const jpResults = JSONPath({ path: p, json: arr });
      expect(JSON.parse(pifferoRaw)).toEqual(jpResults);
    }
  });
});
