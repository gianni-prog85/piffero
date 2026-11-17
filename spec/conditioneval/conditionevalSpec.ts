import {
  ConditionEval,
  NOTHING,
  rfc9535Equals,
} from "../../src/conditioneval/conditioneval";

describe("ConditionEval", function () {
  it("simple condition", function () {
    ConditionEval.createCondition('?(!.attribute==="asd")');
    // TODO assert
  });

  it("and condition", function () {
    ConditionEval.createCondition('?(!.attribute==="asd" && !.check===false)');
    // TODO assert
  });

  it("or condition", function () {
    ConditionEval.createCondition('?(!.attribute==="asd" || !.check===true)');
    // TODO assert
  });

  it("or condition", function () {
    const result = ConditionEval.createCondition('?(!.attribute===1+2 || !.check===true)');
    expect(result.length).toBeGreaterThan(0);
  });

  it("evaluates complex filter expressions", function () {
    const item = { price: 15, inStock: true, address: { city: "Rome" }, tags: ["a", "b"] };
    expect(ConditionEval.evaluateFilter("@.price >= 10 && @.inStock", item)).toBeTrue();
    expect(ConditionEval.evaluateFilter("@.address.city === 'Rome'", item)).toBeTrue();
    expect(ConditionEval.evaluateFilter("@.address.country === 'IT'", item)).toBeFalse();
    expect(ConditionEval.evaluateFilter("@.missing.deep === 1", item)).toBeFalse();
    expect(ConditionEval.evaluateFilter("!@.deleted && @.tags[1] === 'b'", item)).toBeTrue();
    expect(ConditionEval.evaluateFilter("@ > 10", 15)).toBeTrue();
    expect(ConditionEval.evaluateFilter("@ > 10", 5)).toBeFalse();
  });

  it("evaluates script expressions", function () {
    expect(ConditionEval.evaluateScript("1 + 2 * 3", undefined)).toBe(7);
    expect(ConditionEval.evaluateScript("@.length - 1", [10, 20, 30])).toBe(2);
  });

  describe("RFC 9535 §2.3.5.2 Nothing, Existence, Equality and Comparisons", function () {
    it("evaluates existence tests on present falsy values as true and missing paths as false", function () {
      expect(ConditionEval.evaluateFilter("@.a", { a: false })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.a", { a: 0 })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.a", { a: "" })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.a", { a: null })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.a", { a: {} })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.a", { a: [] })).toBeTrue();

      expect(ConditionEval.evaluateFilter("@.a", {})).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.a.b", { a: null })).toBeFalse();
      expect(ConditionEval.evaluateFilter("@[0]", [])).toBeFalse();
      expect(ConditionEval.evaluateFilter("@[-1]", [])).toBeFalse();

      expect(ConditionEval.evaluateFilter("!@.a", { a: false })).toBeFalse();
      expect(ConditionEval.evaluateFilter("!@.a", { a: null })).toBeFalse();
      expect(ConditionEval.evaluateFilter("!@.a", {})).toBeTrue();
    });

    it("implements rfc9535Equals without JS coercion and with deep structural equality", function () {
      expect(rfc9535Equals(NOTHING, NOTHING)).toBeTrue();
      expect(rfc9535Equals(NOTHING, null)).toBeFalse();
      expect(rfc9535Equals(null, null)).toBeTrue();
      expect(rfc9535Equals(1, 1.0)).toBeTrue();
      expect(rfc9535Equals(-0, 0)).toBeTrue();
      expect(rfc9535Equals("1", 1)).toBeFalse();
      expect(rfc9535Equals(true, 1)).toBeFalse();
      expect(rfc9535Equals(false, 0)).toBeFalse();
      expect(rfc9535Equals(null, false)).toBeFalse();
      expect(rfc9535Equals("", 0)).toBeFalse();
      expect(rfc9535Equals([], {})).toBeFalse();

      expect(rfc9535Equals([1, { a: 2, b: 3 }], [1, { b: 3, a: 2 }])).toBeTrue();
      expect(rfc9535Equals([1, 2], [2, 1])).toBeFalse();
      expect(rfc9535Equals({ a: 1 }, { a: 1, b: 2 })).toBeFalse();
      expect(rfc9535Equals({ a: undefined }, {})).toBeFalse();
    });

    it("evaluates == and != per RFC 9535 Table 10", function () {
      const obj = { s: "1", n: 1, t: true, f: false, z: 0, nil: null, arr: [1, 2], rec: { x: 1, y: 2 } };
      expect(ConditionEval.evaluateFilter("@.a == @.b", {})).toBeTrue(); // Nothing == Nothing
      expect(ConditionEval.evaluateFilter("@.a != @.b", {})).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.a == null", {})).toBeFalse(); // Nothing != null
      expect(ConditionEval.evaluateFilter("@.a != null", {})).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.nil == null", obj)).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.s == 1", obj)).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.s != 1", obj)).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.t == 1", obj)).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.f == 0", obj)).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.nil == false", obj)).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.rec == @.other", { rec: { x: 1, y: 2 }, other: { y: 2, x: 1 } })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.arr == @.other", { arr: [1, 2], other: [1, 2] })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.arr == @.rec", obj)).toBeFalse();
    });

    it("evaluates <, <=, >, >= strictly for matching number/string types and derived identities", function () {
      // Type-safe ordered comparisons
      expect(ConditionEval.evaluateFilter("@.a < @.b", { a: 1, b: 2 })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.a < @.b", { a: "a", b: "b" })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.a > @.b", { a: "2", b: 1 })).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.a < @.b", { a: "1", b: 2 })).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.a <= @.b", { a: "1", b: 2 })).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.a < @.b", { a: false, b: true })).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.a <= @.b", { a: false, b: true })).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.a <= 0", { a: null })).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.a >= 0", { a: null })).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.missing < 1", {})).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.missing > 1", {})).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.missing <= 1", {})).toBeFalse();

      // RFC 9535 §2.3.5.2.2 derived <= and >= from < || ==
      expect(ConditionEval.evaluateFilter("@.missing <= @.other", {})).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.missing >= @.other", {})).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.a <= @.b", { a: null, b: null })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.a >= @.b", { a: true, b: true })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.a <= @.b", { a: { x: 1 }, b: { x: 1 } })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.a >= @.b", { a: [1, 2], b: [1, 2] })).toBeTrue();
    });

    it("supports negative integer array indexing and returns NOTHING for non-integer or out-of-bounds", function () {
      const data = { arr: [10, 20, 30] };
      expect(ConditionEval.evaluateFilter("@.arr[-1] == 30", data)).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.arr[-4]", data)).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.arr[1.5]", data)).toBeFalse();
    });
  });
});
