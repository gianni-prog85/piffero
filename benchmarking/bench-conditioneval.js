/**
 * Microbenchmark for ConditionEval RFC 9535 filter evaluation (#24):
 * Measures pure CPU throughput (ops/sec & ns/op) for:
 * - Existence tests (?@.prop on present falsy values vs NOTHING)
 * - Primitive equality fast-path (==, != without JS coercion)
 * - Type-safe ordered comparisons (<, <=, >, >=)
 * - Deep structural equality (objects & arrays via rfc9535Equals)
 *
 * RUN: npm run benchmark:filters
 */
const { performance } = require("perf_hooks");
const {
  ConditionEval,
  NOTHING,
  rfc9535Equals,
} = require("../dist/src/conditioneval/conditioneval.js");

function runBench(name, iterations, fn) {
  // Warmup
  for (let i = 0; i < 10_000; i++) {
    fn(i);
  }
  const start = performance.now();
  let truthy = 0;
  for (let i = 0; i < iterations; i++) {
    if (fn(i)) truthy++;
  }
  const elapsedMs = performance.now() - start;
  const nsPerOp = (elapsedMs * 1e6) / iterations;
  const opsPerSec = Math.round((iterations / elapsedMs) * 1000);
  return {
    scenario: name,
    iterations,
    totalMs: Number(elapsedMs.toFixed(2)),
    nsPerOp: Number(nsPerOp.toFixed(1)),
    opsPerSec,
    _guard: truthy,
  };
}

function main() {
  const N = 200_000;

  const presentFalsy = { flag: false, count: 0, text: "", nil: null };
  const missingDeep = { a: { x: 1 } };
  const eventHit = { type: "IssuesEvent", payload: { issue: { number: 1500 } } };
  const eventMiss = { type: "PushEvent", payload: {} };
  const orderedSame = { a: 1500, b: 1000 };
  const orderedMismatch = { a: "1500", b: 1000 };
  const nestedA = {
    meta: { id: 42, tags: ["rfc9535", "jsonpath", "streaming"], ok: true },
    other: { ok: true, tags: ["rfc9535", "jsonpath", "streaming"], id: 42 },
  };
  const nestedB = {
    meta: { id: 42, tags: ["rfc9535", "jsonpath", "streaming"], ok: true },
    other: { ok: false, tags: ["rfc9535", "jsonpath", "streaming"], id: 42 },
  };

  // Pre-compile ASTs to mirror JsonPathEngine hot loop
  const astExists = ConditionEval.compile("@.flag");
  const astMissing = ConditionEval.compile("@.a.b.c");
  const astEqStr = ConditionEval.compile('@.type == "IssuesEvent"');
  const astNothingEq = ConditionEval.compile("@.x == @.y");
  const astGtNum = ConditionEval.compile("@.a > @.b");
  const astGtMismatch = ConditionEval.compile("@.a > @.b");
  const astDeepEq = ConditionEval.compile("@.meta == @.other");
  const astLenAscii = ConditionEval.compile("length(@.text) > 5");
  const astLenUnicode = ConditionEval.compile("length(@.emoji) == 3");
  const astCountQuery = ConditionEval.compile("count(@.tags[*]) >= 2");
  const astValueQuery = ConditionEval.compile("value(@.single[*]) == 42");
  const astMatch = ConditionEval.compile('match(@.type, "[A-Z][a-z]+Event")');
  const astSearch = ConditionEval.compile('search(@.type, "Issues")');

  const funcDocAscii = { text: "IssuesEvent" };
  const funcDocUnicode = { emoji: "😀ok" };
  const funcDocNodes = { tags: ["rfc9535", "jsonpath", "streaming"], single: [42] };

  const rows = [
    runBench("Existence present falsy (@.flag)", N, () =>
      ConditionEval.evalFilterAst(astExists, presentFalsy)
    ),
    runBench("Existence missing deep (@.a.b.c -> NOTHING)", N, () =>
      ConditionEval.evalFilterAst(astMissing, missingDeep)
    ),
    runBench('Equality string hit/miss (@.type == "IssuesEvent")', N, (i) =>
      ConditionEval.evalFilterAst(astEqStr, (i & 1) === 0 ? eventHit : eventMiss)
    ),
    runBench("Nothing == Nothing (@.x == @.y)", N, () =>
      ConditionEval.evalFilterAst(astNothingEq, missingDeep)
    ),
    runBench("Ordered numeric (@.a > @.b)", N, () =>
      ConditionEval.evalFilterAst(astGtNum, orderedSame)
    ),
    runBench("Ordered type mismatch string vs num (@.a > @.b)", N, () =>
      ConditionEval.evalFilterAst(astGtMismatch, orderedMismatch)
    ),
    runBench("Deep structural equality (@.meta == @.other)", N, (i) =>
      ConditionEval.evalFilterAst(astDeepEq, (i & 1) === 0 ? nestedA : nestedB)
    ),
    runBench("rfc9535Equals direct: NOTHING vs null/NOTHING", N, (i) =>
      rfc9535Equals(NOTHING, (i & 1) === 0 ? NOTHING : null)
    ),
    runBench("rfc9535Equals direct: primitive fast-path", N, (i) =>
      rfc9535Equals("IssuesEvent", (i & 1) === 0 ? "IssuesEvent" : "PushEvent")
    ),
    runBench("RFC9535 length() ASCII fast-path", N, () =>
      ConditionEval.evalFilterAst(astLenAscii, funcDocAscii)
    ),
    runBench("RFC9535 length() UTF-16 surrogate count", N, () =>
      ConditionEval.evalFilterAst(astLenUnicode, funcDocUnicode)
    ),
    runBench("RFC9535 count(@.tags[*])", N, () =>
      ConditionEval.evalFilterAst(astCountQuery, funcDocNodes)
    ),
    runBench("RFC9535 value(@.single[*])", N, () =>
      ConditionEval.evalFilterAst(astValueQuery, funcDocNodes)
    ),
    runBench("RFC9535 match() precompiled I-Regexp", N, (i) =>
      ConditionEval.evalFilterAst(astMatch, (i & 1) === 0 ? eventHit : eventMiss)
    ),
    runBench("RFC9535 search() precompiled I-Regexp", N, (i) =>
      ConditionEval.evalFilterAst(astSearch, (i & 1) === 0 ? eventHit : eventMiss)
    ),
  ];

  // Strip internal guard from display
  console.table(
    rows.map(({ _guard, ...rest }) => rest)
  );
}

main();
