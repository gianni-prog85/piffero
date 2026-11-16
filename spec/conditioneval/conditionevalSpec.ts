import { ConditionEval } from "../../src/conditioneval/conditioneval";

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
});
