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
        "$.items[?(!@.inStock || @.price < 5)].name"
      );
      expect(JSON.parse(negOut)).toEqual(["Pen", "Laptop"]);
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
        "$[?(@.price * 2 >= 30 && @.inStock)].id"
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
        "$.items[?@.inStock && @.price >= 15].name"
      );
      expect(JSON.parse(out2)).toEqual(["Book", "Desk"]);

      const out3 = await Piffero.findAsPromise(
        makeStream(sampleEmployees),
        "$.items[?(@.price < 5 || @.price > 500) && !@.inStock].name"
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
});
