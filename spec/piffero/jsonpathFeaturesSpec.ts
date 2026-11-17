import { Readable } from "stream";
import { Piffero } from "../../src/piffero";
import { parse, PifferoError, PifferoJsonPathError } from "../../src/handler/mastehandler";
import { streamToString } from "../utils";

const sampleEmployees = {
  company: "Acme",
  employees: [
    {
      name: "John",
      surname: "Doe",
      active: true,
      age: 30,
      address: { city: "Rome", zip: "00100" },
      tags: ["dev", "ts"],
      phoneNumbers: [
        { type: "iPhone", number: "0123-4567-8888", primary: false },
        { type: "home", number: "0123-4567-8910", primary: true },
      ],
    },
    {
      name: "Joe",
      surname: "Black",
      active: false,
      age: 22,
      address: { city: "Milan", zip: "20100" },
      tags: ["ops"],
      phoneNumbers: [],
    },
    {
      name: "Anna",
      surname: "Verdi",
      active: true,
      age: 28,
      isbn: "978-3-16-148410-0",
      tags: ["lead", "arch", "ts"],
      phoneNumbers: [
        { type: "work", number: "0999-1111-2222", primary: true },
      ],
    },
  ],
  scores: [5, 12, 8, 20, 15],
  items: [
    { id: 1, name: "Pen", price: 2.5, inStock: true },
    { id: 2, name: "Book", price: 15, inStock: true },
    { id: 3, name: "Laptop", price: 999, inStock: false },
    { id: 4, name: "Desk", price: 120, inStock: true },
  ],
};

function makeStream(data: any): Readable {
  return Readable.from([JSON.stringify(data)]);
}

describe("JSONPath complete features", function () {
  describe("Wildcard * (Issue #8)", function () {
    it("should extract a property across all array elements via findByPath", async function () {
      const stream = Piffero.findByPath(makeStream(sampleEmployees), "$.employees[*].name");
      const out = await streamToString(stream);
      expect(JSON.parse(out)).toEqual(["John", "Joe", "Anna"]);
    });

    it("should support findAsString and findAsPromise with wildcard", async function () {
      const promiseOut = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.employees[*].name"
      );
      expect(JSON.parse(promiseOut)).toEqual(["John", "Joe", "Anna"]);

      await new Promise<void>((resolve) => {
        Piffero.findAsString(
          (res, err) => {
            expect(err).toBeNull();
            expect(JSON.parse(res)).toEqual(["John", "Joe", "Anna"]);
            resolve();
          },
          makeStream(sampleEmployees),
          "$.employees[*].name"
        );
      });
    });

    it("should extract all top-level properties with $.*", async function () {
      const obj = { a: 1, b: "hello", c: { d: true } };
      const out = await Piffero.findAsPromise(makeStream(obj), "$.*");
      expect(JSON.parse(out)).toEqual([1, "hello", { d: true }]);
    });

    it("should extract all properties of a nested object with $.employees[0].address.*", async function () {
      const out = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.employees[0].address.*"
      );
      expect(JSON.parse(out)).toEqual(["Rome", "00100"]);
    });

    it("should support chained wildcards", async function () {
      const out = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.employees[*].phoneNumbers[*].number"
      );
      expect(JSON.parse(out)).toEqual([
        "0123-4567-8888",
        "0123-4567-8910",
        "0999-1111-2222",
      ]);
    });

    it("should support root array wildcard $[*]", async function () {
      const out = await Piffero.findAsPromise(makeStream([10, 20, 30]), "$[*]");
      expect(JSON.parse(out)).toEqual([10, 20, 30]);
    });
  });

  describe("Recursive Descent .. (Issue #9)", function () {
    it("should find all occurrences of phoneNumbers at any depth", async function () {
      const out = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$..phoneNumbers"
      );
      expect(JSON.parse(out)).toEqual([
        sampleEmployees.employees[0].phoneNumbers,
        sampleEmployees.employees[1].phoneNumbers,
        sampleEmployees.employees[2].phoneNumbers,
      ]);
    });

    it("should find all scalar number fields across the document", async function () {
      const out = await Piffero.findAsPromise(makeStream(sampleEmployees), "$..number");
      expect(JSON.parse(out)).toEqual([
        "0123-4567-8888",
        "0123-4567-8910",
        "0999-1111-2222",
      ]);
    });

    it("should scope recursive descent to a subtree ($.employees..type)", async function () {
      const data = {
        type: "root-ignored",
        employees: sampleEmployees.employees,
        other: { type: "other-ignored" },
      };
      const out = await Piffero.findAsPromise(makeStream(data), "$.employees..type");
      expect(JSON.parse(out)).toEqual(["iPhone", "home", "work"]);
    });

    it("should preserve depth-first pre-order for self-nested matches", async function () {
      const nested = {
        a: { a: 1, c: { a: 2 } },
        b: { a: 3 },
      };
      const out = await Piffero.findAsPromise(makeStream(nested), "$..a");
      expect(JSON.parse(out)).toEqual([{ a: 1, c: { a: 2 } }, 1, 2, 3]);
    });

    it("should support recursive descent combined with subscripts and wildcards", async function () {
      const out = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$..phoneNumbers[0].type"
      );
      expect(JSON.parse(out)).toEqual(["iPhone", "work"]);
    });

    it("should support $..* depth-first pre-order", async function () {
      const small = { a: [10, 20], b: { c: true } };
      const out = await Piffero.findAsPromise(makeStream(small), "$..*");
      expect(JSON.parse(out)).toEqual([[10, 20], 10, 20, { c: true }, true]);
    });
  });

  describe("Current Element @ (Issue #11)", function () {
    it("should filter primitive array elements using @", async function () {
      const out = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.scores[?(@ > 10)]"
      );
      expect(JSON.parse(out)).toEqual([12, 20, 15]);
    });

    it("should filter primitive string arrays using @", async function () {
      const data = { tags: ["cillum", "ad", "eu", "ad"] };
      const out = await Piffero.findAsPromise(
        makeStream(data),
        "$.tags[?(@ === 'ad')]"
      );
      expect(JSON.parse(out)).toEqual(["ad", "ad"]);
    });

    it("should access nested properties via @ without crashing on missing parents", async function () {
      const out = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.employees[?(@.address.city==='Rome')].name"
      );
      expect(JSON.parse(out)).toEqual(["John"]);
    });

    it("should access nested arrays and .length via @", async function () {
      const out = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.employees[?(@.tags[0] === 'lead' || @.tags.length === 2)].name"
      );
      expect(JSON.parse(out)).toEqual(["John", "Anna"]);
    });
  });

  describe("Complete Filter Expressions ?() (Issue #10)", function () {
    it("should support comparison operators (!==, !=, ==, >, <, >=, <=)", async function () {
      const gtOut = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.items[?(@.price > 100)].name"
      );
      expect(JSON.parse(gtOut)).toEqual(["Laptop", "Desk"]);

      const lteOut = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.items[?(@.price <= 15)].name"
      );
      expect(JSON.parse(lteOut)).toEqual(["Pen", "Book"]);

      const neqOut = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.employees[?(@.age !== 22)].name"
      );
      expect(JSON.parse(neqOut)).toEqual(["John", "Anna"]);
    });

    it("should support logical operators &&, ||, ! and grouping parentheses", async function () {
      const out = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.items[?(@.price >= 10 && @.inStock === true)].name"
      );
      expect(JSON.parse(out)).toEqual(["Book", "Desk"]);

      const negOut = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.items[?(@.inStock == false || @.price < 5)].name"
      );
      expect(JSON.parse(negOut)).toEqual(["Pen", "Laptop"]);

      // Negated existence check (!) matches only when property is absent
      const missingOut = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.employees[?(!@.isbn)].name"
      );
      expect(JSON.parse(missingOut)).toEqual(["John", "Joe"]);
    });

    it("should support property existence checks [?(@.isbn)]", async function () {
      const out = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.employees[?(@.isbn)].name"
      );
      expect(JSON.parse(out)).toEqual(["Anna"]);
    });

    it("should support root array filters and arithmetic inside filters", async function () {
      const out = await Piffero.findAsPromise(
        makeStream(sampleEmployees.items),
        "$[?(@.price * 2 >= 30 && @.inStock == true)].id"
      );
      expect(JSON.parse(out)).toEqual([2, 4]);
    });

    it("should preserve pre-order when recursive descent is combined with a filter", async function () {
      const data = {
        root: { a: 1, child: { a: 1, val: "inner" }, val: "outer" },
      };
      const out = await Piffero.findAsPromise(makeStream(data), "$..[?(@.a === 1)].val");
      expect(JSON.parse(out)).toEqual(["outer", "inner"]);
    });

    it("should support RFC 9535 filter expressions without outer parentheses ?[...]", async function () {
      const out1 = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.items[?@.price < 10].name"
      );
      expect(JSON.parse(out1)).toEqual(["Pen"]);

      const out2 = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.items[?@.inStock == true && @.price >= 15].name"
      );
      expect(JSON.parse(out2)).toEqual(["Book", "Desk"]);

      const out3 = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.items[?(@.price < 5 || @.price > 500) && @.inStock == false].name"
      );
      expect(JSON.parse(out3)).toEqual(["Laptop"]);

      const out4 = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.scores[?@ > 12]"
      );
      expect(JSON.parse(out4)).toEqual([20, 15]);
    });
  });

  describe("Script Expressions () (Issue #12)", function () {
    it("should evaluate static arithmetic index expressions", async function () {
      const out = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.employees[(1+1)].name"
      );
      expect(JSON.parse(out)).toEqual(["Anna"]);
    });

    it("should evaluate @.length-based dynamic index expressions", async function () {
      const lastOut = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.employees[(@.length-1)].name"
      );
      expect(JSON.parse(lastOut)).toEqual(["Anna"]);

      const prevOut = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.employees[(@.length - 2)].name"
      );
      expect(JSON.parse(prevOut)).toEqual(["Joe"]);
    });

    it("should handle @.length-1 on empty arrays without error", async function () {
      const out = await Piffero.findAsPromise(
        makeStream({ employees: [] }),
        "$.employees[(@.length-1)]"
      );
      expect(JSON.parse(out)).toEqual([]);
    });

    it("should support @.length-1 on root array via stream", async function () {
      const stream = Piffero.findByPath(makeStream(["first", "second", "last"]), "$[(@.length-1)]");
      const out = await streamToString(stream);
      expect(JSON.parse(out)).toEqual(["last"]);
    });
  });

  describe("Additional JSONPath parser & error cases", function () {
    it("should support quoted property names and key unions", async function () {
      const out1 = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$['company']"
      );
      expect(JSON.parse(out1)).toEqual(["Acme"]);

      const out2 = await Piffero.findAsPromise(
        makeStream(sampleEmployees.employees[0]),
        "$['name','surname']"
      );
      expect(JSON.parse(out2)).toEqual(["John", "Doe"]);
    });

    it("should throw PifferoJsonPathError on invalid syntax", function () {
      const invalidPaths = [
        "$.",
        "$..",
        "$...a",
        "$.a[",
        "$.a[]",
        "$.a[?]",
        "$.a[?()]",
        "$.a[()]",
        "$.a[?(@.x === )]",
      ];
      for (const p of invalidPaths) {
        expect(() => parse(p)).toThrowError(PifferoJsonPathError);
      }
    });

    it("should propagate PifferoError on malformed JSON stream in StreamingPathEngine", function (done) {
      const malformed = Readable.from(['{"a": 1.2.3}']);
      const stream = Piffero.findByPath(malformed, "$..a");
      stream.on("error", (err) => {
        expect(err instanceof PifferoError).toBeTrue();
        done();
      });
    });

    it("should handle small chunked streams, falsy values, and empty containers", async function () {
      const data = {
        zero: 0,
        f: false,
        n: null,
        emptyStr: "",
        emptyObj: {},
        emptyArr: [],
        nested: { arr: [[10, 20], [30, 40]] },
      };
      const raw = JSON.stringify(data);
      const smallChunks = Readable.from(raw.match(/.{1,3}/g) || [raw]);
      const allProps = await streamToString(Piffero.findByPath(smallChunks, "$.*"));
      expect(JSON.parse(allProps)).toEqual([
        0,
        false,
        null,
        "",
        {},
        [],
        { arr: [[10, 20], [30, 40]] },
      ]);

      const recIdx = await Piffero.findAsPromise(makeStream(data), "$..[0]");
      expect(JSON.parse(recIdx)).toEqual([[10, 20], 10, 30]);
    });

    it("should handle multi-step union/slice followed by property and negative slices", async function () {
      const unionOut = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.employees[0,2].name"
      );
      expect(JSON.parse(unionOut)).toEqual(["John", "Anna"]);

      const sliceOut = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.employees[0:2].name"
      );
      expect(JSON.parse(sliceOut)).toEqual(["John", "Joe"]);

      const negSlice = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.scores[-2:]"
      );
      expect(JSON.parse(negSlice)).toEqual([20, 15]);

      const negIdx = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.scores[-1]"
      );
      expect(JSON.parse(negIdx)).toEqual([15]);
    });

    it("should support RFC 9535 array slice semantics (step < 0, step === 0, end === 0)", async function () {
      const arr = ["a", "b", "c", "d", "e", "f", "g"];

      // RFC 9535 §2.3.4.3 examples
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(arr), "$[1:3]"))).toEqual(["b", "c"]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(arr), "$[5:]"))).toEqual(["f", "g"]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(arr), "$[1:5:2]"))).toEqual(["b", "d"]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(arr), "$[5:1:-2]"))).toEqual(["f", "d"]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(arr), "$[::-1]"))).toEqual(["g", "f", "e", "d", "c", "b", "a"]);

      // end === 0 must mean index 0 (empty for [0:0], reverse up to index 1 for [5:0:-2])
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(arr), "$[0:0]"))).toEqual([]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream({ arr }), "$.arr[0:0]"))).toEqual([]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream({ arr }), "$.arr[-2:0]"))).toEqual([]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(arr), "$[5:0:-2]"))).toEqual(["f", "d", "b"]);

      // step === 0 returns empty nodelist without throwing
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(arr), "$[1:5:0]"))).toEqual([]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream({ arr }), "$.arr[0:5:0]"))).toEqual([]);

      // Negative end / start with negative step (including tailKeep ring buffer)
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(arr), "$[:-4:-1]"))).toEqual(["g", "f", "e"]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(arr), "$[:-1:-1]"))).toEqual([]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(arr), "$[-3::-1]"))).toEqual(["e", "d", "c", "b", "a"]);

      // Nested object array with reverse slice + property projection + stream mode
      const revNames = await streamToString(
        Piffero.findByPath(makeStream(sampleEmployees), "$.employees[::-1].name")
      );
      expect(JSON.parse(revNames)).toEqual(["Anna", "Joe", "John"]);

      // Slice after filter (evaluated in-memory by evaluateStepsOnValue)
      const postFilterSlice = await Piffero.findAsPromise(
        makeStream({ items: [{ ok: true, tags: ["x", "y", "z"] }] }),
        "$.items[?(@.ok === true)].tags[::-1]"
      );
      expect(JSON.parse(postFilterSlice)).toEqual(["z", "y", "x"]);

      const postFilterZeroEnd = await Piffero.findAsPromise(
        makeStream({ items: [{ ok: true, tags: ["x", "y", "z"] }] }),
        "$.items[?(@.ok === true)].tags[0:0]"
      );
      expect(JSON.parse(postFilterZeroEnd)).toEqual([]);
    });

    it("should flush StreamingPathEngine output cleanly across >4KB threshold", async function () {
      const big = {
        items: Array.from({ length: 200 }, (_, i) => ({
          id: i,
          label: `item-number-${i}-${"x".repeat(30)}`,
        })),
      };
      const out = await streamToString(
        Piffero.findByPath(makeStream(big), "$.items[*].label")
      );
      const parsed = JSON.parse(out);
      expect(parsed.length).toBe(200);
      expect(parsed[0]).toBe(`item-number-0-${"x".repeat(30)}`);
      expect(parsed[199]).toBe(`item-number-199-${"x".repeat(30)}`);
    });
  });

  describe("RFC 9535 Lexical Escapes, I-JSON Limits & Member Name Shorthand (Issue #25)", function () {
    it("should decode \\b, \\f, \\n, \\r, \\t, \\/, \\uXXXX, and surrogate pairs in quoted selectors", async function () {
      const obj = {
        "\b": "bs",
        "\f": "ff",
        "a/b": "slash",
        "😀": "grinning",
        a: "alpha",
        "line\nbreak\t1": "ctrl",
        "q'single": "sq",
        'q"double': "dq",
      };

      expect(JSON.parse(await Piffero.findAsPromise(makeStream(obj), "$['\\b']"))).toEqual(["bs"]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(obj), "$['\\f']"))).toEqual(["ff"]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(obj), "$['a\\/b']"))).toEqual(["slash"]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(obj), "$['\\uD83D\\uDE00']"))).toEqual(["grinning"]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(obj), '$["\\uD83D\\uDE00"]'))).toEqual(["grinning"]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(obj), "$['\\u0061']"))).toEqual(["alpha"]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(obj), "$['line\\nbreak\\t1']"))).toEqual(["ctrl"]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(obj), "$['q\\'single']"))).toEqual(["sq"]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(obj), '$["q\\"double"]'))).toEqual(["dq"]);

      // Also match when the input JSON itself encodes keys as \uXXXX / \/ escapes
      const rawEscapedJson = '{"\\uD83D\\uDE00":"grinning","\\u0061":"alpha","a\\/b":"slash"}';
      expect(JSON.parse(await Piffero.findAsPromise(Readable.from([rawEscapedJson]), "$['\\uD83D\\uDE00']"))).toEqual(["grinning"]);
      expect(JSON.parse(await Piffero.findAsPromise(Readable.from([rawEscapedJson]), "$.a"))).toEqual(["alpha"]);
      expect(JSON.parse(await Piffero.findAsPromise(Readable.from([rawEscapedJson]), "$['a/b']"))).toEqual(["slash"]);

      // Key union and recursive descent with surrogate pair escapes
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(obj), "$['\\b','\\f','\\uD83D\\uDE00']"))).toEqual([
        "bs",
        "ff",
        "grinning",
      ]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream({ nested: obj }), "$..['\\uD83D\\uDE00']"))).toEqual([
        "grinning",
      ]);
    });

    it("should decode surrogate pairs and escapes inside filter string literals", async function () {
      const items = [
        { id: 1, icon: "😀", note: "ok\b\f/x" },
        { id: 2, icon: "🚀", note: "other" },
      ];
      expect(
        JSON.parse(
          await Piffero.findAsPromise(
            makeStream(items),
            '$[?(@.icon === "\\uD83D\\uDE00")].id'
          )
        )
      ).toEqual([1]);
      expect(
        JSON.parse(
          await Piffero.findAsPromise(
            makeStream(items),
            "$[?(@.note === 'ok\\b\\f\\/x')].id"
          )
        )
      ).toEqual([1]);
    });

    it("should reject malformed escapes, lone surrogates, and unescaped control characters", function () {
      const invalidEscapePaths = [
        "$['\\u12']",
        "$['\\u']",
        "$['\\uZZZZ']",
        "$['\\uD83D']",
        "$['\\uD83Dabc']",
        "$['\\uD83D\\u0041']",
        "$['\\uDE00']",
        "$['\\a']",
        "$['\\x20']",
        "$[\"\\'\"]",
        "$['\\\"']",
        "$['a\nb']",
        "$['a\\']",
        '$[?(@.x === "\\uD83D")]',
        '$[?(@.x === "\\u12")]',
        '$[?(@.x === "\\a")]',
        '$[?(@.x === "a\nb")]',
      ];
      for (const p of invalidEscapePaths) {
        expect(() => parse(p)).toThrowError(PifferoJsonPathError);
      }
    });

    it("should enforce I-JSON integer bounds [-(2^53)+1, (2^53)-1] on index and slice selectors", function () {
      expect(() => parse("$[9007199254740991]")).not.toThrow();
      expect(() => parse("$[-9007199254740991]")).not.toThrow();
      expect(() => parse("$[9007199254740991:9007199254740991:1]")).not.toThrow();
      expect(() => parse("$[0]")).not.toThrow();

      const invalidIntPaths = [
        "$[9007199254740992]",
        "$[-9007199254740992]",
        "$[0,9007199254740992]",
        "$[9007199254740992:1]",
        "$[0:9007199254740992]",
        "$[0:10:9007199254740992]",
        "$[01]",
        "$[-0]",
        "$[01:2]",
        "$[0:-0]",
      ];
      for (const p of invalidIntPaths) {
        expect(() => parse(p)).toThrowError(PifferoJsonPathError);
      }
    });

    it("should validate member-name-shorthand per RFC 9535 §2.5.1.1", async function () {
      const data = {
        _ok1: 10,
        "😀": 20,
        nested: { _inner2: 30 },
      };
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(data), "$._ok1"))).toEqual([10]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(data), "$.😀"))).toEqual([20]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(data), "$.._inner2"))).toEqual([30]);

      const invalidShorthands = [
        "$.1",
        "$.1a",
        "$..0",
        "$.foo-bar",
        "$.foo bar",
        "$.$a",
        "$.a+b",
        "$. a",
        "$.a ",
        "$.\uD800",
      ];
      for (const p of invalidShorthands) {
        expect(() => parse(p)).toThrowError(PifferoJsonPathError);
      }
    });
  });

  describe("RFC 9535 Filter Semantics, Comparisons and Nothing (Issue #24)", function () {
    it("should distinguish present falsy values from missing properties in existence tests", async function () {
      const items = [
        { id: 1, v: false, details: { huge: [1, 2, 3] } },
        { id: 2, v: 0, details: { huge: "ignored" } },
        { id: 3, v: "", details: null },
        { id: 4, v: null, details: false },
        { id: 5, v: {}, details: [] },
        { id: 6, v: [] },
        { id: 7 },
      ];

      expect(JSON.parse(await Piffero.findAsPromise(makeStream(items), "$[?@.v].id"))).toEqual([
        1, 2, 3, 4, 5, 6,
      ]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(items), "$[?!@.v].id"))).toEqual([7]);
      // With post-filter projection (PrunedJsBuilder usedAsTruthiness path)
      expect(
        JSON.parse(await Piffero.findAsPromise(makeStream(items), "$[?@.details].id"))
      ).toEqual([1, 2, 3, 4, 5]);
      expect(
        JSON.parse(await Piffero.findAsPromise(makeStream(items), "$[?!@.details].id"))
      ).toEqual([6, 7]);
    });

    it("should evaluate == and != without JS coercion and with Nothing & structural equality", async function () {
      const items = [
        { id: 1, a: "1", b: 1, meta: { x: 1, y: [2, 3] }, other: { y: [2, 3], x: 1 } },
        { id: 2, a: null, b: false, meta: [1, 2], other: { "0": 1, "1": 2 } },
        { id: 3, a: true, b: 1, meta: null },
        { id: 4, b: null },
        { id: 5 },
      ];

      expect(JSON.parse(await Piffero.findAsPromise(makeStream(items), "$[?@.a == 1].id"))).toEqual([
        // Neither "1" nor true equals number 1
      ]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(items), "$[?@.a != 1].id"))).toEqual([
        1, 2, 3, 4, 5,
      ]);
      expect(
        JSON.parse(await Piffero.findAsPromise(makeStream(items), "$[?@.a == null].id"))
      ).toEqual([2]); // item 4 & 5 have Nothing, not null
      expect(
        JSON.parse(await Piffero.findAsPromise(makeStream(items), "$[?@.a == @.b].id"))
      ).toEqual([5]); // Nothing == Nothing on item 5
      // Structural equality with post-filter projection (PrunedJsBuilder captureFull path)
      expect(
        JSON.parse(await Piffero.findAsPromise(makeStream(items), "$[?@.meta == @.other].id"))
      ).toEqual([1, 4, 5]);
    });

    it("should enforce type-safe ordered comparisons (<, <=, >, >=)", async function () {
      const items = [
        { id: 1, a: "2", b: 1 },
        { id: 2, a: 2, b: 1 },
        { id: 3, a: "b", b: "a" },
        { id: 4, a: null, b: 0 },
        { id: 5, a: null, b: null },
        { id: 6, a: false, b: true },
        { id: 7 },
      ];

      expect(JSON.parse(await Piffero.findAsPromise(makeStream(items), "$[?@.a > @.b].id"))).toEqual(
        [2, 3]
      );
      expect(
        JSON.parse(await Piffero.findAsPromise(makeStream(items), "$[?@.a <= @.b].id"))
      ).toEqual([5, 7]);
      expect(
        JSON.parse(await Piffero.findAsPromise(makeStream(items), "$[?@.a >= 0].id"))
      ).toEqual([2]);
    });
  });

  describe("RFC 9535 Heterogeneous Unions, Order & Duplicates (Issue #22)", function () {
    it("should preserve selector order and duplicates for integer index unions $[2, 0, 2]", async function () {
      const arr = ["a", "b", "c", "d"];
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(arr), "$[2, 0, 2]"))).toEqual([
        "c",
        "a",
        "c",
      ]);

      expect(
        JSON.parse(
          await Piffero.findAsPromise(makeStream(sampleEmployees), "$.employees[2, 0, 2].name")
        )
      ).toEqual(["Anna", "John", "Anna"]);

      expect(
        JSON.parse(
          await Piffero.findAsPromise(makeStream(sampleEmployees.employees), "$[2, 0, 2].name")
        )
      ).toEqual(["Anna", "John", "Anna"]);

      const objArr = [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }];
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(objArr), "$[0, 2]"))).toEqual([
        { id: 0 },
        { id: 2 },
      ]);
      expect(JSON.parse(await Piffero.findAsPromise(makeStream(objArr), "$[2, 0]"))).toEqual([
        { id: 2 },
        { id: 0 },
      ]);
    });

    it("should preserve selector order and duplicates for member name unions $['b', 'a', 'b']", async function () {
      const obj = { a: 1, b: 2, c: 3 };
      expect(
        JSON.parse(await Piffero.findAsPromise(makeStream(obj), "$['b', 'a', 'b']"))
      ).toEqual([2, 1, 2]);

      // Distinct union keys must also emit in selector order, not document key order
      expect(
        JSON.parse(await Piffero.findAsPromise(makeStream(obj), "$['c', 'a']"))
      ).toEqual([3, 1]);

      // Union keys with downstream projection
      const nested = {
        a: { v: "first" },
        b: { v: "second" },
      };
      expect(
        JSON.parse(await Piffero.findAsPromise(makeStream(nested), "$['b', 'a', 'b'].v"))
      ).toEqual(["second", "first", "second"]);
    });

    it("should support heterogeneous unions combining indexes, slices, and wildcards $[0, 2:4, *]", async function () {
      const arr = [10, 20, 30, 40];
      expect(
        JSON.parse(await Piffero.findAsPromise(makeStream(arr), "$[0, 2:4, *]"))
      ).toEqual([10, 30, 40, 10, 20, 30, 40]);

      expect(
        JSON.parse(
          await Piffero.findAsPromise(makeStream(sampleEmployees), "$.items[0, 2:4, *].id")
        )
      ).toEqual([1, 3, 4, 1, 2, 3, 4]);
    });

    it("should support mixed key and filter selectors $['name', ?(@.active)] on objects and arrays", async function () {
      const mixedObj = {
        name: "Acme",
        lead: { active: true, id: 1 },
        intern: { active: false, id: 2 },
        other: "ignored",
      };
      // ?(@.active == true) selects only active === true
      expect(
        JSON.parse(
          await Piffero.findAsPromise(makeStream(mixedObj), "$['name', ?(@.active == true)]")
        )
      ).toEqual(["Acme", { active: true, id: 1 }]);

      // RFC 9535 existence test ?(@.active) matches present falsy `active: false` too
      expect(
        JSON.parse(await Piffero.findAsPromise(makeStream(mixedObj), "$['name', ?(@.active)]"))
      ).toEqual(["Acme", { active: true, id: 1 }, { active: false, id: 2 }]);

      expect(
        JSON.parse(
          await Piffero.findAsPromise(
            makeStream(sampleEmployees),
            "$.employees[?(@.active == true), 1].name"
          )
        )
      ).toEqual(["John", "Anna", "Joe"]);
    });

    it("should support negative indices, reverse slices, script expressions, and parenless filters inside unions", async function () {
      const arr = [10, 20, 30, 40, 50];
      expect(
        JSON.parse(await Piffero.findAsPromise(makeStream(arr), "$[1:3, -1, (0+0)]"))
      ).toEqual([20, 30, 50, 10]);

      expect(
        JSON.parse(
          await Piffero.findAsPromise(makeStream(sampleEmployees.items), "$[?@.price > 100, 0:2].name")
        )
      ).toEqual(["Laptop", "Desk", "Pen", "Book"]);

      // Nested brackets and commas inside quotes must not split union selectors
      expect(
        JSON.parse(
          await Piffero.findAsPromise(
            makeStream(sampleEmployees.employees),
            "$[?(@.tags[0] === 'lead' || @.name === 'a,b'), 0].name"
          )
        )
      ).toEqual(["Anna", "John"]);
    });

    it("should support unions after filters and with recursive descent", async function () {
      expect(
        JSON.parse(
          await Piffero.findAsPromise(
            makeStream(sampleEmployees.employees),
            "$[?(@.active == true)]['surname', 'name']"
          )
        )
      ).toEqual(["Doe", "John", "Verdi", "Anna"]);

      expect(
        JSON.parse(
          await Piffero.findAsPromise(
            makeStream(sampleEmployees.employees),
            "$[?(@.active == true)].tags[1, 0]"
          )
        )
      ).toEqual(["ts", "dev", "arch", "lead"]);

      const tree = { a: { b: 1, a: 2 }, b: 3 };
      expect(
        JSON.parse(await Piffero.findAsPromise(makeStream(tree), "$..['b', 'a', 'b']"))
      ).toEqual([3, { b: 1, a: 2 }, 3, 1, 2, 1]);
    });

    it("should stop reading source stream early for bounded heterogeneous root unions", async function () {
      let chunksRead = 0;
      const total = 500;
      const source = new Readable({
        read() {
          if (chunksRead === 0) {
            chunksRead++;
            this.push("[");
          } else if (chunksRead <= total) {
            const idx = chunksRead - 1;
            const prefix = idx === 0 ? "" : ",";
            chunksRead++;
            this.push(`${prefix}${idx}`);
          } else {
            this.push("]");
            this.push(null);
          }
        },
      });

      const out = await Piffero.findAsPromise(source, "$[2, 0, 2]");
      expect(JSON.parse(out)).toEqual([2, 0, 2]);
      expect(chunksRead).toBeLessThan(20);
    });

    it("should reject malformed union syntax", function () {
      const invalidPaths = [
        "$[]",
        "$[   ]",
        "$[, 1]",
        "$[1, ]",
        "$[1, , 2]",
        "$['unclosed, 1]",
        "$[?(1, 2]",
      ];
      for (const p of invalidPaths) {
        expect(() => parse(p)).toThrowError(PifferoJsonPathError);
      }
    });
  });

  describe("Full JSONPath Queries in Filters & Root ($) References (Issue #21)", function () {
    it("should support recursive descent inside filters $[?(@..price > 10)]", async function () {
      const orders = [
        { id: 1, details: { pricing: { price: 5 } } },
        { id: 2, details: { pricing: { price: 25 } } },
        { id: 3, details: [{ price: 8 }, { price: 15 }] },
        { id: 4, details: { note: "no price" } },
      ];
      expect(
        JSON.parse(await Piffero.findAsPromise(makeStream(orders), "$[?(@..price > 10)].id"))
      ).toEqual([2, 3]);
    });

    it("should support wildcards, slices, and unions inside filter expressions", async function () {
      const docs = [
        { name: "a", tags: ["ops", "dev"], scores: [1, 2, 3] },
        { name: "b", tags: [], scores: [10, 20, 30] },
        { name: "c", tags: ["qa"], scores: [5, 20, 7] },
      ];
      expect(
        JSON.parse(await Piffero.findAsPromise(makeStream(docs), "$[?(@.tags[*])].name"))
      ).toEqual(["a", "c"]);

      expect(
        JSON.parse(await Piffero.findAsPromise(makeStream(docs), "$[?(@.tags[*] == 'dev')].name"))
      ).toEqual(["a"]);

      expect(
        JSON.parse(await Piffero.findAsPromise(makeStream(docs), "$[?(@.scores[1:3] == 20)].name"))
      ).toEqual(["b", "c"]);
    });

    it("should support nested filters inside filter sub-queries", async function () {
      const teams = [
        { team: "alpha", members: [{ name: "Ada", active: false }, { name: "Bob", active: true }] },
        { team: "beta", members: [{ name: "Carl", active: false }] },
        { team: "gamma", members: [{ name: "Dana", active: true }] },
        { team: "delta", members: [{ name: "Eli" }] },
      ];
      expect(
        JSON.parse(
          await Piffero.findAsPromise(makeStream(teams), "$[?(@.members[?(@.active == true)])].team")
        )
      ).toEqual(["alpha", "gamma"]);

      // Existence check matches present falsy values (`active: false`) but excludes `delta` (absent `active`)
      expect(
        JSON.parse(
          await Piffero.findAsPromise(makeStream(teams), "$[?(@.members[?(@.active)])].team")
        )
      ).toEqual(["alpha", "beta", "gamma"]);

      expect(
        JSON.parse(
          await Piffero.findAsPromise(makeStream(teams), "$[?@.members[?@.name == 'Ada']].team")
        )
      ).toEqual(["alpha"]);
    });

    it("should support root ($) references when property appears BEFORE filtered array", async function () {
      const data = {
        maxPrice: 50,
        config: { minStock: 5 },
        items: [
          { name: "Pen", price: 10, stock: 10 },
          { name: "Lamp", price: 45, stock: 2 },
          { name: "Chair", price: 80, stock: 20 },
        ],
      };
      expect(
        JSON.parse(
          await Piffero.findAsPromise(makeStream(data), "$.items[?(@.price < $.maxPrice)].name")
        )
      ).toEqual(["Pen", "Lamp"]);

      expect(
        JSON.parse(
          await Piffero.findAsPromise(
            makeStream(data),
            "$.items[?(@.price < $.maxPrice && @.stock >= $.config.minStock)].name"
          )
        )
      ).toEqual(["Pen"]);
    });

    it("should support root ($) references when property appears AFTER filtered array in stream", async function () {
      const data = {
        items: [
          { id: 1, price: 12 },
          { id: 2, price: 60 },
          { id: 3, price: 29 },
        ],
        noise: { huge: "ignored-by-root-projection", arr: [1, 2, 3] },
        config: { maxPrice: 30 },
        maxPrice: 30,
      };
      const raw = JSON.stringify(data);
      const chunked = Readable.from(raw.match(/.{1,7}/g) || [raw]);
      expect(
        JSON.parse(
          await Piffero.findAsPromise(chunked, "$.items[?(@.price < $.maxPrice)].id")
        )
      ).toEqual([1, 3]);

      expect(
        JSON.parse(
          await Piffero.findAsPromise(
            makeStream(data),
            "$.items[?(@.price < $.config.maxPrice)]"
          )
        )
      ).toEqual([
        { id: 1, price: 12 },
        { id: 3, price: 29 },
      ]);

      // Complex root query $..maxPrice appearing after items
      expect(
        JSON.parse(
          await Piffero.findAsPromise(makeStream(data), "$.items[?(@.price < $..maxPrice)].id")
        )
      ).toEqual([1, 3]);

      // Missing root field yields empty results safely
      expect(
        JSON.parse(
          await Piffero.findAsPromise(makeStream(data), "$.items[?(@.price < $.missingLimit)].id")
        )
      ).toEqual([]);
    });

    it("should support root ($) references on scalar arrays, unions, and root array indexing", async function () {
      const scalarBefore = { limit: 15, values: [5, 20, 10, 30] };
      const scalarAfter = { values: [5, 20, 10, 30], limit: 15 };

      expect(
        JSON.parse(await Piffero.findAsPromise(makeStream(scalarBefore), "$.values[?(@ < $.limit)]"))
      ).toEqual([5, 10]);
      expect(
        JSON.parse(await Piffero.findAsPromise(makeStream(scalarAfter), "$.values[?(@ < $.limit)]"))
      ).toEqual([5, 10]);
      expect(
        JSON.parse(
          await Piffero.findAsPromise(makeStream(scalarAfter), "$.values[?(@ < $.limit), -1]")
        )
      ).toEqual([5, 10, 30]);

      const rootArr = [{ limit: 25, price: 10 }, { limit: 5, price: 20 }, { limit: 5, price: 30 }];
      expect(
        JSON.parse(await Piffero.findAsPromise(makeStream(rootArr), "$[?(@.price < $[0].limit)].price"))
      ).toEqual([10, 20]);
    });

    it("should support root ($) reference inside dynamic script index", async function () {
      const dataBefore = { idx: 1, items: ["first", "second", "third"] };
      const dataAfter = { items: ["first", "second", "third"], idx: 1 };
      expect(
        JSON.parse(await Piffero.findAsPromise(makeStream(dataBefore), "$.items[($.idx)]"))
      ).toEqual(["second"]);
      expect(
        JSON.parse(await Piffero.findAsPromise(makeStream(dataAfter), "$.items[($.idx)]"))
      ).toEqual(["second"]);
    });

    it("should throw PifferoJsonPathError on invalid query syntax inside filter", function () {
      expect(() => parse("$[?(@.. > 10)]")).toThrowError(PifferoJsonPathError);
      expect(() => parse("$[?(@.tags[ == 'a')]")).toThrowError(PifferoJsonPathError);
    });
  });
});
