import { Readable } from "stream";
import { Piffero } from "../../src/piffero";
import { parse, PifferoError } from "../../src/handler/mastehandler";
import { ConditionEval } from "../../src/conditioneval/conditioneval";
import { streamToString } from "../utils";

function makeChunkedBufferStream(json: string, chunkSize: number): Readable {
  const buf = Buffer.from(json, "utf8");
  let offset = 0;
  return new Readable({
    read() {
      if (offset >= buf.length) {
        this.push(null);
        return;
      }
      const end = Math.min(offset + chunkSize, buf.length);
      this.push(buf.subarray(offset, end));
      offset = end;
    },
  });
}

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

  describe("CParser.writeBuffer Buffer chunk boundaries", function () {
    it("should decode multi-byte UTF-8, escapes, and split numbers identically across small Buffer chunks", async function () {
      const payload = [
        {
          id: 1,
          text: 'Città 🚀 € àèìòù \\ "quoted" \\\\ line\\nbreak \u00e9',
          num: -123.45e-2,
          flags: [true, false, null],
        },
        {
          id: 2,
          text: "Seconda riga 😊",
          num: 0.007,
          flags: [false, true, null],
        },
      ];
      const json = JSON.stringify(payload);

      for (const size of [1, 2, 3, 5, 17]) {
        const streamRes = await streamToString(
          Piffero.findByPath(makeChunkedBufferStream(json, size), "$[*]")
        );
        expect(JSON.parse(streamRes)).toEqual(payload);

        const strRes = await Piffero.findAsPromise(
          makeChunkedBufferStream(json, size),
          "$[*].text"
        );
        expect(JSON.parse(strRes)).toEqual(payload.map((x) => x.text));
      }
    });

    it("should handle escaped object keys across chunk boundaries", async function () {
      const payload = [
        { 'k"1': { 'inner\\key': 42 }, skip: { deep: "🚀ignored" } },
      ];
      const json = JSON.stringify(payload);
      const out = await Piffero.findAsPromise(
        makeChunkedBufferStream(json, 2),
        '$[*]["k\\"1"]["inner\\\\key"]'
      );
      expect(JSON.parse(out)).toEqual([42]);
    });
  });

  describe("StreamingPathEngine early exit on bounded root selectors", function () {
    it("should stop reading source stream early for $[0,1], $[0:2], and $[(1+1)] in stream and string modes", async function () {
      const totalItems = 200;
      const items = Array.from({ length: totalItems }, (_, i) => ({
        idx: i,
        data: "x".repeat(200),
      }));
      const json = JSON.stringify(items);

      const cases: Array<{ path: string; expected: number[] }> = [
        { path: "$[0,1].idx", expected: [0, 1] },
        { path: "$[0:2].idx", expected: [0, 1] },
        { path: "$[(1+1)].idx", expected: [2] },
      ];

      for (const tc of cases) {
        let chunksReadStream = 0;
        const buf = Buffer.from(json, "utf8");
        let off1 = 0;
        const src1 = new Readable({
          read() {
            if (off1 >= buf.length) {
              this.push(null);
              return;
            }
            chunksReadStream++;
            const end = Math.min(off1 + 256, buf.length);
            this.push(buf.subarray(off1, end));
            off1 = end;
          },
        });
        const streamOut = await streamToString(Piffero.findByPath(src1, tc.path));
        expect(JSON.parse(streamOut)).toEqual(tc.expected);
        expect(chunksReadStream).toBeLessThan(20);

        let chunksReadString = 0;
        let off2 = 0;
        const src2 = new Readable({
          read() {
            if (off2 >= buf.length) {
              this.push(null);
              return;
            }
            chunksReadString++;
            const end = Math.min(off2 + 256, buf.length);
            this.push(buf.subarray(off2, end));
            off2 = end;
          },
        });
        const strOut = await Piffero.findAsPromise(src2, tc.path);
        expect(JSON.parse(strOut)).toEqual(tc.expected);
        expect(chunksReadString).toBeLessThan(20);
      }
    });

    it("should support early exit on root array of primitives", async function () {
      const nums = Array.from({ length: 100 }, (_, i) => i * 10);
      const out = await Piffero.findAsPromise(
        makeChunkedBufferStream(JSON.stringify(nums), 32),
        "$[0,2]"
      );
      expect(JSON.parse(out)).toEqual([0, 20]);
    });
  });

  describe("PrunedJsBuilder filter projection edge cases", function () {
    it("should handle truthiness on objects, arrays, and falsy scalars cleanly", async function () {
      const data = [
        { flag: { nested: "ignored", extra: [1, 2, 3] }, val: 1 },
        { flag: [1, 2], val: 2 },
        { flag: null, val: 3 },
        { flag: false, val: 4 },
        { flag: 0, val: 5 },
        { flag: "", val: 6 },
        { val: 7 },
      ];
      const truthy = await Piffero.findAsPromise(
        Readable.from([JSON.stringify(data)]),
        "$[?(@.flag)].val"
      );
      expect(JSON.parse(truthy)).toEqual([1, 2]);

      const falsy = await Piffero.findAsPromise(
        Readable.from([JSON.stringify(data)]),
        "$[?(!@.flag)].val"
      );
      expect(JSON.parse(falsy)).toEqual([3, 4, 5, 6, 7]);
    });

    it("should handle .length on arrays, strings, and objects in filter projections", async function () {
      const data = [
        { tags: ["a", "b"], title: "abcd", meta: { length: 5 }, id: 1 },
        { tags: ["a"], title: "ab", meta: { length: 2 }, id: 2 },
      ];
      const out = await Piffero.findAsPromise(
        Readable.from([JSON.stringify(data)]),
        "$[?(@.tags.length === 2 && @.title.length === 4 && @.meta.length === 5)].id"
      );
      expect(JSON.parse(out)).toEqual([1]);
    });

    it("should handle logical OR object fallback in filter expressions and unexpected array shapes", async function () {
      const data = [
        { a: { x: 1 }, b: { x: 2 }, meta: [1, 2, 3], id: 1 },
        { a: null, b: { x: 1 }, meta: { num: 99 }, id: 2 },
      ];
      const orOut = await Piffero.findAsPromise(
        Readable.from([JSON.stringify(data)]),
        "$[?((@.a || @.b).x === 1)].id"
      );
      expect(JSON.parse(orOut)).toEqual([1, 2]);

      const arrVsObj = await Piffero.findAsPromise(
        Readable.from([JSON.stringify(data)]),
        "$[?(@.meta)].meta.num"
      );
      expect(JSON.parse(arrVsObj)).toEqual([99]);
    });
  });

  describe("String-mode chunk buffering on large outputs", function () {
    it("should produce exact JSON output when exceeding 16 KB buffer threshold", async function () {
      const items = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        payload: "value_" + i + "_" + "a".repeat(30),
      }));
      const json = JSON.stringify({ items });

      const legacyOut = await Piffero.findAsPromise(
        makeChunkedBufferStream(json, 1024),
        "$.items[0:].payload"
      );
      expect(JSON.parse(legacyOut)).toEqual(items.map((x) => x.payload));

      const engineOut = await Piffero.findAsPromise(
        makeChunkedBufferStream(json, 1024),
        "$.items[*].payload"
      );
      expect(JSON.parse(engineOut)).toEqual(items.map((x) => x.payload));
    });
  });
});
