import * as fs from "fs";
import { Piffero } from "../../src/piffero";

const bfj = require("bfj");

function collectBfj(
  filePath: string,
  selector: string | ((key: any, value: any, depth: number) => boolean),
  options: Record<string, any> = {}
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const matches: any[] = [];
    const out = bfj.match(fs.createReadStream(filePath), selector, options);
    out.on("data", (val: any) => matches.push(val));
    out.on("end", () => resolve(matches));
    out.on("error", reject);
    out.on("dataError", reject);
  });
}

describe("Piffero vs bfj parity", function () {
  it("matches bfj.match key selector output for $..number on john-doe.json", async function () {
    const [pifferoRaw, bfjResults] = await Promise.all([
      Piffero.findAsPromise(fs.createReadStream("spec/jsonFiles/john-doe.json"), "$..number"),
      collectBfj("spec/jsonFiles/john-doe.json", "number"),
    ]);
    expect(JSON.parse(pifferoRaw)).toEqual(bfjResults);
  });

  it("matches bfj.match key selector output for $..type on john-doe.json and test.json", async function () {
    for (const file of ["spec/jsonFiles/john-doe.json", "spec/jsonFiles/test.json"]) {
      const [pifferoRaw, bfjResults] = await Promise.all([
        Piffero.findAsPromise(fs.createReadStream(file), "$..type"),
        collectBfj(file, "type"),
      ]);
      expect(JSON.parse(pifferoRaw)).toEqual(bfjResults);
    }
  });

  it("matches bfj.match key selector output for $..a on test.json", async function () {
    const [pifferoRaw, bfjResults] = await Promise.all([
      Piffero.findAsPromise(fs.createReadStream("spec/jsonFiles/test.json"), "$..a"),
      collectBfj("spec/jsonFiles/test.json", "a"),
    ]);
    expect(JSON.parse(pifferoRaw)).toEqual(bfjResults);
  });

  it("matches bfj.match depth-1 predicate output for $[*] on large.json", async function () {
    const [pifferoRaw, bfjResults] = await Promise.all([
      Piffero.findAsPromise(fs.createReadStream("spec/jsonFiles/large.json"), "$[*]"),
      collectBfj("spec/jsonFiles/large.json", (_k, _v, d) => d === 1),
    ]);
    expect(JSON.parse(pifferoRaw)).toEqual(bfjResults);
  });

  it("matches bfj.match predicate output for boolean filter on john-doe.json", async function () {
    const [pifferoRaw, bfjResults] = await Promise.all([
      Piffero.findAsPromise(
        fs.createReadStream("spec/jsonFiles/john-doe.json"),
        "$.phoneNumbers[?(@.test === true)]"
      ),
      collectBfj(
        "spec/jsonFiles/john-doe.json",
        (_k, v, d) => d === 2 && Boolean(v && typeof v === "object" && v.test === true)
      ),
    ]);
    expect(JSON.parse(pifferoRaw)).toEqual(bfjResults);
  });

  it("preserves null values in results while bfj.match skips null values", async function () {
    const [pifferoRaw, bfjResults] = await Promise.all([
      Piffero.findAsPromise(fs.createReadStream("spec/jsonFiles/john-doe.json"), "$..null"),
      collectBfj("spec/jsonFiles/john-doe.json", "null"),
    ]);
    expect(JSON.parse(pifferoRaw)).toEqual([null]);
    expect(bfjResults).toEqual([]);
  });

  it("supports full JSONPath expressions where bfj.match either throws or misses array paths", async function () {
    expect(() =>
      bfj.match(fs.createReadStream("spec/jsonFiles/test.json"), "$.*")
    ).toThrow();
    expect(() =>
      bfj.match(fs.createReadStream("spec/jsonFiles/john-doe.json"), "$..number")
    ).toThrow();

    const [pifferoWildcard, bfjWildcard] = await Promise.all([
      Piffero.findAsPromise(
        fs.createReadStream("spec/jsonFiles/john-doe.json"),
        "$.phoneNumbers[*].number"
      ),
      collectBfj("spec/jsonFiles/john-doe.json", "$.phoneNumbers[*].number"),
    ]);
    expect(JSON.parse(pifferoWildcard)).toEqual(["0123-4567-8888", "0123-4567-8910"]);
    expect(bfjWildcard).toEqual([]);
  });
});
