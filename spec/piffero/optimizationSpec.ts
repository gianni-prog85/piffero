import { Readable } from "stream";
import { Piffero } from "../../src/piffero";
import { parse, PifferoError } from "../../src/handler/mastehandler";
import { ConditionEval } from "../../src/conditioneval/conditioneval";
import { streamToString } from "../utils";

describe("piffero optimizations", function () {
  const fs = require("fs");

  it("should not materialize indexes array for large slices", function () {
    const parsed = parse("$.items[0:1000000:2]");
    expect(parsed.next.indexes).toBeUndefined();
    expect(parsed.next.range).toEqual({ start: 0, end: 1000000, step: 2 });
  });

  it("should use Set for explicit union indexes", function () {
    const parsed = parse("$.items[1,4,7]");
    expect(parsed.next.indexes instanceof Set).toBeTrue();
    expect(parsed.next.indexes.has(1)).toBeTrue();
    expect(parsed.next.indexes.has(4)).toBeTrue();
    expect(parsed.next.indexes.has(2)).toBeFalse();
  });

  it("should evaluate large slice range correctly in O(1)", async function () {
    const stream = fs.createReadStream("spec/jsonFiles/large.json");
    const result = Piffero.findByPath(stream, "$[2].tags[0:1000000:2]");
    const str = await streamToString(result);
    expect(str).toBe('["cillum","ad","eu"]');
  });

  it("should propagate PifferoError on output stream in findByPath", function (done) {
    const malformed = Readable.from(['{"a": 1.2.3}']);
    const result = Piffero.findByPath(malformed, "$.a");
    result.on("error", (err) => {
      expect(err instanceof PifferoError).toBeTrue();
      done();
    });
  });

  it("should evaluate static literals and arithmetic in ConditionEval without esprima", function () {
    expect(ConditionEval.staticEval("2")).toBe("2");
    expect(ConditionEval.staticEval("true")).toBe("true");
    expect(ConditionEval.staticEval("1 + 2")).toBe("3");
  });
});
