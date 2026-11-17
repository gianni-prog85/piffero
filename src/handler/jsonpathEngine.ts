import { ConditionEval, ExprNode } from "../conditioneval/conditioneval";
import { SaxHandler } from "../libs/clarinet/cstream";

export type JsonPathStep =
  | { kind: "child"; key: string; recursive?: boolean }
  | { kind: "wildcard"; recursive?: boolean }
  | { kind: "index"; indexes: Set<number>; rawIndexes: number[]; recursive?: boolean }
  | { kind: "slice"; start?: number; end?: number; step: number; recursive?: boolean }
  | { kind: "unionKeys"; keys: Set<string>; recursive?: boolean }
  | { kind: "filter"; expr: string; ast: ExprNode; recursive?: boolean }
  | {
      kind: "script";
      expr: string;
      ast: ExprNode;
      staticIndex?: number;
      lengthOffset?: number | null;
      recursive?: boolean;
    };

export interface LegacyCondition {
  key: string;
  value: string;
}

export interface LegacyParsedPath {
  value: string;
  range?: { start?: number; end?: number; step?: number };
  indexes?: Set<number>;
  isbulk: boolean;
  condition?: LegacyCondition;
  next: LegacyParsedPath;
  hascondtion: boolean;
  recursiveDescendant: boolean;
  steps?: JsonPathStep[];
  needsStreamingEngine?: boolean;
}

export const PATH_ERROR_MESSAGE = "Invalid json path";

export class PifferoJsonPathError extends Error {}

function findMatchingBracket(
  str: string,
  openIndex: number,
  openChar: string,
  closeChar: string
): number {
  let depth = 0;
  let i = openIndex;
  while (i < str.length) {
    const ch = str[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      let closed = false;
      while (i < str.length) {
        if (str[i] === "\\") {
          i += 2;
          continue;
        }
        if (str[i] === quote) {
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        return -1;
      }
      continue;
    }
    if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
    i++;
  }
  return -1;
}

function splitOutsideQuotes(str: string, delimiter: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < str.length) {
        if (str[i] === "\\") {
          i += 2;
          continue;
        }
        if (str[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === delimiter) {
      parts.push(str.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  parts.push(str.slice(start));
  return parts;
}

function tryUnquoteString(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length < 2) {
    return null;
  }
  const quote = trimmed[0];
  if ((quote !== "'" && quote !== '"') || trimmed[trimmed.length - 1] !== quote) {
    return null;
  }
  // Ensure the closing quote is actually the matching one for index 0
  let i = 1;
  while (i < trimmed.length - 1) {
    if (trimmed[i] === "\\") {
      i += 2;
      continue;
    }
    if (trimmed[i] === quote) {
      return null;
    }
    i++;
  }
  if (i !== trimmed.length - 1) {
    return null;
  }
  const inner = trimmed.slice(1, -1);
  return inner.replace(/\\(.)/g, (_, c) => {
    switch (c) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      default:
        return c;
    }
  });
}

function parseBracketSubscript(
  inner: string,
  recursive: boolean,
  fullPath: string
): JsonPathStep {
  if (inner.length === 0) {
    throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
  }

  if (inner === "*") {
    return { kind: "wildcard", recursive };
  }

  // Filter expression: ?expr or ?(expr) (RFC 9535 §2.3.5)
  if (inner.startsWith("?")) {
    let expr = inner.slice(1).trim();
    if (!expr) {
      throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
    }
    if (
      expr.startsWith("(") &&
      findMatchingBracket(expr, 0, "(", ")") === expr.length - 1
    ) {
      expr = expr.slice(1, -1).trim();
      if (!expr) {
        throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
      }
    }
    try {
      const ast = ConditionEval.compile(expr);
      return { kind: "filter", expr, ast, recursive };
    } catch {
      throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
    }
  }

  // Script expression: (...)
  if (inner.startsWith("(")) {
    const closeParen = findMatchingBracket(inner, 0, "(", ")");
    if (closeParen !== inner.length - 1) {
      throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
    }
    const expr = inner.slice(1, -1).trim();
    if (!expr) {
      throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
    }
    try {
      const ast = ConditionEval.compile(expr);
      let staticIndex: number | undefined;
      if (!ConditionEval.usesContext(ast)) {
        const val = ConditionEval.evalAst(ast, undefined);
        if (typeof val === "number" && Number.isInteger(val)) {
          staticIndex = val;
        }
      }
      const lengthOffset = ConditionEval.extractLengthOffset(ast);
      return {
        kind: "script",
        expr,
        ast,
        staticIndex,
        lengthOffset,
        recursive,
      };
    } catch {
      throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
    }
  }

  // Quoted property name or union of quoted property names
  const commaParts = splitOutsideQuotes(inner, ",");
  if (commaParts.length > 0 && commaParts.every((p) => tryUnquoteString(p) !== null)) {
    const keys = commaParts.map((p) => tryUnquoteString(p) as string);
    if (keys.length === 1) {
      return { kind: "child", key: keys[0], recursive };
    }
    return { kind: "unionKeys", keys: new Set(keys), recursive };
  }

  // Slice [start:end] or [start:end:step]
  const colonParts = splitOutsideQuotes(inner, ":");
  if (colonParts.length > 1) {
    if (colonParts.length > 3) {
      throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
    }
    const [startRaw, endRaw, stepRaw] = colonParts.map((s) => s.trim());
    if (
      (startRaw !== "" && !/^-?\d+$/.test(startRaw)) ||
      (endRaw !== "" && !/^-?\d+$/.test(endRaw)) ||
      (stepRaw !== undefined && stepRaw !== "" && !/^-?\d+$/.test(stepRaw))
    ) {
      throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
    }
    const start = startRaw === "" ? undefined : Number(startRaw);
    const end = endRaw === "" ? undefined : Number(endRaw);
    const step = stepRaw === undefined || stepRaw === "" ? 1 : Number(stepRaw);
    return { kind: "slice", start, end, step, recursive };
  }

  // Numeric union [1,2,3] or single index [0]
  if (commaParts.every((p) => /^-?\d+$/.test(p.trim()))) {
    const nums = commaParts.map((p) => Number(p.trim()));
    return {
      kind: "index",
      indexes: new Set(nums),
      rawIndexes: nums,
      recursive,
    };
  }

  throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
}

export function tokenizeJsonPath(jsonPath: string): JsonPathStep[] {
  if (!jsonPath || !jsonPath.startsWith("$")) {
    throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${jsonPath}`);
  }
  const steps: JsonPathStep[] = [];
  let i = 1;
  const len = jsonPath.length;

  while (i < len) {
    let recursive = false;
    if (jsonPath[i] === ".") {
      if (i + 1 < len && jsonPath[i + 1] === ".") {
        recursive = true;
        i += 2;
        if (i >= len || jsonPath[i] === ".") {
          throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${jsonPath}`);
        }
      } else {
        i += 1;
        if (i >= len || jsonPath[i] === ".") {
          throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${jsonPath}`);
        }
      }
    } else if (jsonPath[i] !== "[") {
      throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${jsonPath}`);
    }

    if (jsonPath[i] === "[") {
      const closeIdx = findMatchingBracket(jsonPath, i, "[", "]");
      if (closeIdx === -1) {
        throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${jsonPath}`);
      }
      const inner = jsonPath.slice(i + 1, closeIdx).trim();
      i = closeIdx + 1;
      steps.push(parseBracketSubscript(inner, recursive, jsonPath));
      continue;
    }

    if (jsonPath[i] === "*") {
      i++;
      if (i < len && jsonPath[i] !== "." && jsonPath[i] !== "[") {
        throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${jsonPath}`);
      }
      steps.push({ kind: "wildcard", recursive });
      continue;
    }

    // Read property identifier up to '.' or '['
    const start = i;
    while (i < len && jsonPath[i] !== "." && jsonPath[i] !== "[") {
      const ch = jsonPath[i];
      if (ch === "]" || ch === "(" || ch === ")" || ch === "*") {
        throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${jsonPath}`);
      }
      i++;
    }
    const key = jsonPath.slice(start, i);
    if (!key) {
      throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${jsonPath}`);
    }
    steps.push({ kind: "child", key, recursive });
  }

  return steps;
}

function tryExtractSimpleCondition(ast: ExprNode): LegacyCondition | null {
  if (
    ast.type === "binary" &&
    (ast.op === "===" || ast.op === "==") &&
    ast.left.type === "member" &&
    ast.left.object.type === "current" &&
    !ConditionEval.usesContext(ast.right)
  ) {
    const val = ConditionEval.evalAst(ast.right, undefined);
    if (
      typeof val === "string" ||
      typeof val === "number" ||
      typeof val === "boolean" ||
      val === null
    ) {
      return {
        key: JSON.stringify(ast.left.property),
        value: typeof val === "string" ? JSON.stringify(val) : String(val),
      };
    }
  }
  return null;
}

export function buildLegacyAndDetermineEngine(
  jsonPath: string,
  steps: JsonPathStep[]
): LegacyParsedPath {
  const root: LegacyParsedPath = {
    value: '"$"',
    next: null,
    isbulk: false,
    recursiveDescendant: false,
    hascondtion: false,
    steps,
    needsStreamingEngine: false,
  };

  let current = root;
  let needsStreamingEngine = false;

  for (let idx = 0; idx < steps.length; idx++) {
    const step = steps[idx];
    const hasNext = idx + 1 < steps.length;

    if (step.recursive) {
      needsStreamingEngine = true;
    }

    if (step.kind === "wildcard" || step.kind === "script" || step.kind === "unionKeys") {
      needsStreamingEngine = true;
      const node: LegacyParsedPath = {
        value: step.kind === "wildcard" ? '"*"' : '""',
        next: null,
        isbulk: true,
        recursiveDescendant: Boolean(step.recursive),
        hascondtion: false,
      };
      current.next = node;
      current = node;
      continue;
    }

    if (step.kind === "child" && !step.recursive) {
      const node: LegacyParsedPath = {
        value: JSON.stringify(step.key),
        next: null,
        isbulk: false,
        recursiveDescendant: false,
        hascondtion: false,
      };
      current.next = node;
      current = node;
      continue;
    }

    if (step.kind === "child" && step.recursive) {
      const node: LegacyParsedPath = {
        value: JSON.stringify(step.key),
        next: null,
        isbulk: true,
        recursiveDescendant: true,
        hascondtion: false,
      };
      current.next = node;
      current = node;
      continue;
    }

    // Subscript step: index, slice, or filter
    const canAttachToCurrent =
      !step.recursive &&
      !current.isbulk &&
      !current.hascondtion &&
      !current.range &&
      !current.indexes;

    if (step.kind === "index") {
      const hasNegative = step.rawIndexes.some((n) => n < 0);
      const isMulti = step.rawIndexes.length > 1;
      if (hasNegative || (isMulti && hasNext) || !canAttachToCurrent) {
        needsStreamingEngine = true;
      }
      const range = {
        start: step.rawIndexes[0],
        ...(isMulti ? {} : { step: 1 }),
      };
      if (canAttachToCurrent) {
        current.isbulk = true;
        current.range = range;
        current.indexes = new Set(step.indexes);
      } else {
        const node: LegacyParsedPath = {
          value: '""',
          next: null,
          isbulk: true,
          range,
          indexes: new Set(step.indexes),
          recursiveDescendant: Boolean(step.recursive),
          hascondtion: false,
        };
        current.next = node;
        current = node;
      }
      continue;
    }

    if (step.kind === "slice") {
      needsStreamingEngine = true;
      const range = {
        start: step.start !== undefined ? step.start : 0,
        ...(step.end !== undefined ? { end: step.end } : {}),
        step: step.step,
      };
      if (canAttachToCurrent) {
        current.isbulk = true;
        current.range = range;
      } else {
        const node: LegacyParsedPath = {
          value: '""',
          next: null,
          isbulk: true,
          range,
          recursiveDescendant: Boolean(step.recursive),
          hascondtion: false,
        };
        current.next = node;
        current = node;
      }
      continue;
    }

    if (step.kind === "filter") {
      const simpleCond = tryExtractSimpleCondition(step.ast);
      const remainingSteps = steps.slice(idx + 1);
      const onlySimplePostChild = remainingSteps.every(
        (s) =>
          !s.recursive &&
          (s.kind === "child" ||
            (s.kind === "index" && s.rawIndexes.every((n) => n >= 0)) ||
            (s.kind === "slice" &&
              s.step > 0 &&
              (s.start === undefined || s.start >= 0) &&
              (s.end === undefined || s.end >= 0)))
      );
      if (
        !simpleCond ||
        current.value === '"$"' ||
        !canAttachToCurrent ||
        !onlySimplePostChild
      ) {
        needsStreamingEngine = true;
      }
      if (canAttachToCurrent) {
        current.condition = simpleCond || { key: '""', value: '""' };
        current.hascondtion = true;
      } else {
        const node: LegacyParsedPath = {
          value: '""',
          next: null,
          isbulk: false,
          condition: simpleCond || { key: '""', value: '""' },
          hascondtion: true,
          recursiveDescendant: Boolean(step.recursive),
        };
        current.next = node;
        current = node;
      }
      continue;
    }
  }

  root.needsStreamingEngine = needsStreamingEngine;
  return root;
}

// ---------- In-memory evaluation for post-filter / post-script subtrees ----------

function resolveSliceBounds(
  length: number,
  start?: number,
  end?: number,
  step = 1
): { lower: number; upper: number } {
  const nStart = start !== undefined ? start : step >= 0 ? 0 : length - 1;
  const nEnd = end !== undefined ? end : step >= 0 ? length : -length - 1;
  const normStart = nStart >= 0 ? nStart : length + nStart;
  const normEnd = nEnd >= 0 ? nEnd : length + nEnd;

  if (step >= 0) {
    return {
      lower: Math.min(Math.max(normStart, 0), length),
      upper: Math.min(Math.max(normEnd, 0), length),
    };
  }
  return {
    upper: Math.min(Math.max(normStart, -1), length - 1),
    lower: Math.min(Math.max(normEnd, -1), length - 1),
  };
}

export function evaluateStepsOnValue(
  val: any,
  steps: JsonPathStep[],
  stepIndex: number,
  rootValue?: any
): any[] {
  if (stepIndex >= steps.length) {
    return [val];
  }
  const step = steps[stepIndex];
  const results: any[] = [];

  if (step.recursive) {
    const nonRecStep: JsonPathStep = { ...step, recursive: false };
    results.push(
      ...evaluateSingleStepOnValue(val, nonRecStep, steps, stepIndex + 1, rootValue)
    );
    if (val !== null && typeof val === "object") {
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          results.push(...evaluateStepsOnValue(val[i], steps, stepIndex, rootValue));
        }
      } else {
        const keys = Object.keys(val);
        for (let i = 0; i < keys.length; i++) {
          results.push(
            ...evaluateStepsOnValue(val[keys[i]], steps, stepIndex, rootValue)
          );
        }
      }
    }
    return results;
  }

  return evaluateSingleStepOnValue(val, step, steps, stepIndex + 1, rootValue);
}

function evaluateSingleStepOnValue(
  val: any,
  step: JsonPathStep,
  steps: JsonPathStep[],
  nextIndex: number,
  rootValue?: any
): any[] {
  const results: any[] = [];
  if (val === null || val === undefined || typeof val !== "object") {
    return results;
  }

  switch (step.kind) {
    case "child": {
      if (!Array.isArray(val) && Object.prototype.hasOwnProperty.call(val, step.key)) {
        results.push(
          ...evaluateStepsOnValue(val[step.key], steps, nextIndex, rootValue)
        );
      }
      break;
    }
    case "unionKeys": {
      if (!Array.isArray(val)) {
        const keys = Object.keys(val);
        for (let i = 0; i < keys.length; i++) {
          if (step.keys.has(keys[i])) {
            results.push(
              ...evaluateStepsOnValue(val[keys[i]], steps, nextIndex, rootValue)
            );
          }
        }
      }
      break;
    }
    case "wildcard": {
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          results.push(...evaluateStepsOnValue(val[i], steps, nextIndex, rootValue));
        }
      } else {
        const keys = Object.keys(val);
        for (let i = 0; i < keys.length; i++) {
          results.push(
            ...evaluateStepsOnValue(val[keys[i]], steps, nextIndex, rootValue)
          );
        }
      }
      break;
    }
    case "index": {
      if (Array.isArray(val)) {
        const matched = new Set<number>();
        for (const rawIdx of step.rawIndexes) {
          const resolved = rawIdx < 0 ? val.length + rawIdx : rawIdx;
          if (resolved >= 0 && resolved < val.length) {
            matched.add(resolved);
          }
        }
        for (let i = 0; i < val.length; i++) {
          if (matched.has(i)) {
            results.push(
              ...evaluateStepsOnValue(val[i], steps, nextIndex, rootValue)
            );
          }
        }
      }
      break;
    }
    case "slice": {
      if (Array.isArray(val) && step.step !== 0) {
        const { lower, upper } = resolveSliceBounds(
          val.length,
          step.start,
          step.end,
          step.step
        );
        if (step.step > 0) {
          for (let i = lower; i < upper; i += step.step) {
            results.push(...evaluateStepsOnValue(val[i], steps, nextIndex, rootValue));
          }
        } else {
          for (let i = upper; i > lower; i += step.step) {
            results.push(...evaluateStepsOnValue(val[i], steps, nextIndex, rootValue));
          }
        }
      }
      break;
    }
    case "filter": {
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          if (ConditionEval.evalAst(step.ast, val[i], rootValue)) {
            results.push(
              ...evaluateStepsOnValue(val[i], steps, nextIndex, rootValue)
            );
          }
        }
      } else {
        const keys = Object.keys(val);
        for (let i = 0; i < keys.length; i++) {
          const child = val[keys[i]];
          if (ConditionEval.evalAst(step.ast, child, rootValue)) {
            results.push(
              ...evaluateStepsOnValue(child, steps, nextIndex, rootValue)
            );
          }
        }
      }
      break;
    }
    case "script": {
      if (Array.isArray(val)) {
        const computed =
          step.staticIndex !== undefined
            ? step.staticIndex
            : ConditionEval.evalAst(step.ast, val, rootValue);
        if (
          typeof computed === "number" &&
          Number.isInteger(computed) &&
          computed >= 0 &&
          computed < val.length
        ) {
          results.push(
            ...evaluateStepsOnValue(val[computed], steps, nextIndex, rootValue)
          );
        }
      }
      break;
    }
  }
  return results;
}

// ---------- Streaming SAX JSONPath Engine ----------

interface CaptureStackEntry {
  type: "object" | "array";
  hasItem: boolean;
}

class JsonValueCollector {
  private stack: CaptureStackEntry[] = [];
  chunks: string[] = [];
  done = false;

  constructor(private onToken?: (token: string) => void) {}

  private emit(token: string) {
    if (this.onToken) {
      this.onToken(token);
    } else {
      this.chunks.push(token);
    }
  }

  openObject(keyNode?: string) {
    const parent = this.stack[this.stack.length - 1];
    if (parent) {
      if (parent.type === "array" && parent.hasItem) {
        this.emit(keyNode !== undefined ? `,{${keyNode}:` : ",{");
      } else {
        this.emit(keyNode !== undefined ? `{${keyNode}:` : "{");
      }
      parent.hasItem = true;
    } else {
      this.emit(keyNode !== undefined ? `{${keyNode}:` : "{");
    }
    this.stack.push({ type: "object", hasItem: keyNode !== undefined });
  }

  closeObject() {
    this.stack.pop();
    this.emit("}");
    if (this.stack.length === 0) {
      this.done = true;
    }
  }

  openArray() {
    const parent = this.stack[this.stack.length - 1];
    if (parent) {
      if (parent.type === "array" && parent.hasItem) {
        this.emit(",[");
      } else {
        this.emit("[");
      }
      parent.hasItem = true;
    } else {
      this.emit("[");
    }
    this.stack.push({ type: "array", hasItem: false });
  }

  closeArray() {
    this.stack.pop();
    this.emit("]");
    if (this.stack.length === 0) {
      this.done = true;
    }
  }

  key(keyNode: string) {
    const top = this.stack[this.stack.length - 1];
    if (top.hasItem) {
      this.emit(`,${keyNode}:`);
    } else {
      top.hasItem = true;
      this.emit(`${keyNode}:`);
    }
  }

  value(valNode: string) {
    const top = this.stack[this.stack.length - 1];
    if (top) {
      if (top.type === "array" && top.hasItem) {
        this.emit(`,${valNode}`);
      } else {
        top.hasItem = true;
        this.emit(valNode);
      }
    } else {
      this.emit(valNode);
      this.done = true;
    }
  }
}

// ---------- Pruned JS Object Builder for ?() filters with post-steps ----------

interface FilterProjectionNode {
  captureFull: boolean;
  usedAsTruthiness: boolean;
  children: Map<string, FilterProjectionNode>;
}

function createProjectionNode(): FilterProjectionNode {
  return {
    captureFull: false,
    usedAsTruthiness: false,
    children: new Map(),
  };
}

function getOrCreateChildProj(
  node: FilterProjectionNode,
  key: string
): FilterProjectionNode {
  let child = node.children.get(key);
  if (!child) {
    child = createProjectionNode();
    node.children.set(key, child);
  }
  return child;
}

function markProjectionPath(
  root: FilterProjectionNode,
  path: string[],
  asTruthiness: boolean
) {
  let cur = root;
  for (let i = 0; i < path.length; i++) {
    cur = getOrCreateChildProj(cur, path[i]);
  }
  if (asTruthiness) {
    cur.usedAsTruthiness = true;
  } else {
    cur.captureFull = true;
  }
}

function extractCurrentMemberChain(node: ExprNode): string[] | null {
  if (node.type === "current") {
    return [];
  }
  if (node.type === "member") {
    const base = extractCurrentMemberChain(node.object);
    if (base !== null) {
      base.push(node.property);
      return base;
    }
  } else if (
    node.type === "index" &&
    node.index.type === "literal" &&
    typeof node.index.value === "string"
  ) {
    const base = extractCurrentMemberChain(node.object);
    if (base !== null) {
      base.push(node.index.value);
      return base;
    }
  }
  return null;
}

function collectExprProjection(
  node: ExprNode,
  root: FilterProjectionNode,
  truthinessContext: boolean
): boolean {
  switch (node.type) {
    case "literal":
    case "identifier":
      return true;
    case "current":
    case "root":
      return false;
    case "member": {
      const chain = extractCurrentMemberChain(node);
      if (chain !== null) {
        if (chain.length === 0) return false;
        // `.length` might read array/string length -> capture parent array/string in full
        if (chain[chain.length - 1] === "length") {
          if (chain.length === 1) return false;
          markProjectionPath(root, chain.slice(0, -1), false);
        } else {
          markProjectionPath(root, chain, truthinessContext);
        }
        return true;
      }
      return collectExprProjection(node.object, root, false);
    }
    case "index": {
      if (!collectExprProjection(node.index, root, false)) {
        return false;
      }
      const chain = extractCurrentMemberChain(node);
      if (chain !== null) {
        if (chain.length === 0) return false;
        markProjectionPath(root, chain, truthinessContext);
        return true;
      }
      const objChain = extractCurrentMemberChain(node.object);
      if (objChain !== null) {
        if (objChain.length === 0) return false;
        markProjectionPath(root, objChain, false);
        return true;
      }
      return collectExprProjection(node.object, root, false);
    }
    case "unary":
      return collectExprProjection(
        node.argument,
        root,
        node.op === "!" ? true : false
      );
    case "logical":
      return (
        collectExprProjection(node.left, root, truthinessContext) &&
        collectExprProjection(node.right, root, truthinessContext)
      );
    case "binary":
      return (
        collectExprProjection(node.left, root, false) &&
        collectExprProjection(node.right, root, false)
      );
  }
}

function buildFilterProjection(
  ast: ExprNode,
  remainingSteps: JsonPathStep[]
): FilterProjectionNode | null {
  if (remainingSteps.length === 0) {
    return null;
  }
  const root = createProjectionNode();
  if (!collectExprProjection(ast, root, true)) {
    return null;
  }

  let cursors: FilterProjectionNode[] = [root];
  for (let i = 0; i < remainingSteps.length; i++) {
    const step = remainingSteps[i];
    if (step.recursive) {
      return null;
    }
    if (step.kind === "child") {
      const next: FilterProjectionNode[] = [];
      for (let c = 0; c < cursors.length; c++) {
        next.push(getOrCreateChildProj(cursors[c], step.key));
      }
      cursors = next;
    } else if (step.kind === "unionKeys") {
      const next: FilterProjectionNode[] = [];
      for (let c = 0; c < cursors.length; c++) {
        step.keys.forEach((k) => {
          next.push(getOrCreateChildProj(cursors[c], k));
        });
      }
      cursors = next;
    } else {
      // wildcard, index, slice, script, or nested filter at current cursors
      for (let c = 0; c < cursors.length; c++) {
        if (cursors[c] === root) {
          return null;
        }
        cursors[c].captureFull = true;
      }
      return root;
    }
  }

  for (let c = 0; c < cursors.length; c++) {
    if (cursors[c] === root) {
      return null;
    }
    cursors[c].captureFull = true;
  }
  return root;
}

function unquoteJsonString(raw: string): string {
  if (raw.indexOf("\\") === -1) {
    return raw.slice(1, -1);
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw.slice(1, -1);
  }
}

function parseJsonScalar(valNode: string): any {
  if (valNode === "true") return true;
  if (valNode === "false") return false;
  if (valNode === "null") return null;
  if (valNode.length > 0 && valNode.charCodeAt(0) === 0x22) {
    return unquoteJsonString(valNode);
  }
  return Number(valNode);
}

interface PrunedStackEntry {
  type: "object" | "array";
  container: any;
  projNode: FilterProjectionNode | null;
  pendingKey: string | null;
  pendingProj: FilterProjectionNode | null;
  skippingCurrentValue: boolean;
}

class PrunedJsBuilder {
  private stack: PrunedStackEntry[] = [];
  private skipDepth = 0;
  done = false;
  result: any = undefined;

  constructor(private rootProj: FilterProjectionNode) {}

  isSkipping(): boolean {
    if (this.skipDepth > 0) return true;
    const len = this.stack.length;
    return len > 0 && this.stack[len - 1].skippingCurrentValue;
  }

  openObject(keyNode?: string) {
    if (this.skipDepth > 0) {
      this.skipDepth++;
      return;
    }
    const parent = this.stack[this.stack.length - 1];
    if (parent && parent.skippingCurrentValue) {
      parent.skippingCurrentValue = false;
      this.skipDepth = 1;
      return;
    }
    const projNode = !parent
      ? this.rootProj
      : parent.type === "object"
      ? parent.pendingProj
      : null;

    const obj: any = {};
    if (!parent) {
      this.result = obj;
    } else if (parent.type === "object") {
      parent.container[parent.pendingKey as string] = obj;
      parent.pendingKey = null;
      parent.pendingProj = null;
    } else {
      parent.container.push(obj);
    }

    this.stack.push({
      type: "object",
      container: obj,
      projNode: projNode && !projNode.captureFull ? projNode : null,
      pendingKey: null,
      pendingProj: null,
      skippingCurrentValue: false,
    });

    if (keyNode !== undefined) {
      this.key(keyNode);
    }
  }

  closeObject() {
    if (this.skipDepth > 0) {
      this.skipDepth--;
      if (this.skipDepth === 0 && this.stack.length === 0) {
        this.done = true;
      }
      return;
    }
    this.stack.pop();
    if (this.stack.length === 0) {
      this.done = true;
    }
  }

  openArray() {
    if (this.skipDepth > 0) {
      this.skipDepth++;
      return;
    }
    const parent = this.stack[this.stack.length - 1];
    if (parent && parent.skippingCurrentValue) {
      parent.skippingCurrentValue = false;
      this.skipDepth = 1;
      return;
    }
    const projNode = !parent
      ? this.rootProj
      : parent.type === "object"
      ? parent.pendingProj
      : null;

    const arr: any[] = [];
    if (!parent) {
      this.result = arr;
    } else if (parent.type === "object") {
      parent.container[parent.pendingKey as string] = arr;
      parent.pendingKey = null;
      parent.pendingProj = null;
    } else {
      parent.container.push(arr);
    }

    if (projNode && !projNode.captureFull) {
      this.skipDepth = 1;
      return;
    }

    this.stack.push({
      type: "array",
      container: arr,
      projNode: null,
      pendingKey: null,
      pendingProj: null,
      skippingCurrentValue: false,
    });
  }

  closeArray() {
    if (this.skipDepth > 0) {
      this.skipDepth--;
      if (this.skipDepth === 0 && this.stack.length === 0) {
        this.done = true;
      }
      return;
    }
    this.stack.pop();
    if (this.stack.length === 0) {
      this.done = true;
    }
  }

  key(keyNode: string) {
    if (this.skipDepth > 0) {
      return;
    }
    const top = this.stack[this.stack.length - 1];
    const k = unquoteJsonString(keyNode);
    if (top.projNode === null) {
      top.pendingKey = k;
    } else {
      const childProj = top.projNode.children.get(k);
      if (childProj === undefined) {
        top.skippingCurrentValue = true;
      } else {
        top.pendingKey = k;
        top.pendingProj = childProj;
        top.skippingCurrentValue = false;
      }
    }
  }

  value(valNode: string) {
    if (this.skipDepth > 0) {
      return;
    }
    const top = this.stack[this.stack.length - 1];
    if (!top) {
      this.result = parseJsonScalar(valNode);
      this.done = true;
      return;
    }
    if (top.skippingCurrentValue) {
      top.skippingCurrentValue = false;
      return;
    }
    const val = parseJsonScalar(valNode);
    if (top.type === "object") {
      top.container[top.pendingKey as string] = val;
      top.pendingKey = null;
      top.pendingProj = null;
    } else {
      top.container.push(val);
    }
  }
}

interface PendingSlot {
  done: boolean;
  streaming: boolean;
  results: string[];
}

interface ActiveCapture {
  slot: PendingSlot;
  collector: JsonValueCollector;
}

interface ActiveFilter {
  slot: PendingSlot;
  collector: JsonValueCollector | null;
  builder: PrunedJsBuilder | null;
  step: Extract<JsonPathStep, { kind: "filter" }>;
  nextStepIndex: number;
}

interface ActiveArrayCollector {
  slot: PendingSlot;
  stepIndex: number;
  step: JsonPathStep;
  nextStepIndex: number;
  depth: number;
  tailKeep: number | null;
  maxCollectIndex: number | null;
  totalCount: number;
  elements: string[];
  currentElementCollector: JsonValueCollector | null;
}

interface Frame {
  type: "object" | "array";
  depth: number;
  activeSteps: number[];
  elementIndex: number;
  pendingChildSteps: number[];
  arrayCollectors: ActiveArrayCollector[];
}

function pushUnique(arr: number[], val: number) {
  if (arr.indexOf(val) === -1) {
    arr.push(val);
  }
}

export class StreamingPathEngine implements SaxHandler {
  private frameStack: Frame[] = [];
  private pendingSlots: PendingSlot[] = [];
  private activeCaptures: ActiveCapture[] = [];
  private activeFilters: ActiveFilter[] = [];
  private activeElCollectors: ActiveArrayCollector[] = [];
  private hasEmitted = false;
  private rootPendingSteps: number[] = [];
  private skipDepth = 0;
  private filterProjections: Array<FilterProjectionNode | null> = [];
  private rootMaxIndex: number | null = null;
  private earlyExited = false;

  skipDecode = false;
  onend: () => void = () => {};
  onclose: () => void = () => {};
  onerror: (er: any) => void = () => {};

  constructor(
    private steps: JsonPathStep[],
    private emitOutput: (chunk: string) => void,
    private onEarlyExit?: () => void
  ) {
    if (steps.length > 0) {
      this.rootPendingSteps = [0];
      const s0 = steps[0];
      if (!s0.recursive) {
        if (s0.kind === "index" && !s0.rawIndexes.some((n) => n < 0)) {
          this.rootMaxIndex = Math.max(...s0.rawIndexes);
        } else if (s0.kind === "slice" && s0.step === 0) {
          this.rootMaxIndex = -1;
        } else if (
          s0.kind === "slice" &&
          s0.step > 0 &&
          (s0.start === undefined || s0.start >= 0) &&
          s0.end !== undefined &&
          s0.end >= 0
        ) {
          this.rootMaxIndex = s0.end - 1;
        } else if (
          s0.kind === "script" &&
          s0.staticIndex !== undefined &&
          s0.staticIndex >= 0
        ) {
          this.rootMaxIndex = s0.staticIndex;
        }
      }
      for (let i = 0; i < steps.length; i++) {
        const st = steps[i];
        if (st.kind === "filter") {
          this.filterProjections[i] = buildFilterProjection(
            st.ast,
            steps.slice(i + 1)
          );
        } else {
          this.filterProjections[i] = null;
        }
      }
    }
  }

  private updateSkipDecode() {
    if (
      this.activeCaptures.length === 0 &&
      this.activeElCollectors.length === 0
    ) {
      if (this.skipDepth > 0 && this.activeFilters.length === 0) {
        this.skipDecode = true;
        return;
      }
      if (this.activeFilters.length > 0 && this.skipDepth > 0) {
        let allSkipping = true;
        for (let i = 0; i < this.activeFilters.length; i++) {
          const b = this.activeFilters[i].builder;
          if (!b || !b.isSkipping()) {
            allSkipping = false;
            break;
          }
        }
        this.skipDecode = allSkipping;
        return;
      }
    }
    this.skipDecode = false;
  }

  private checkEarlyExit() {
    if (
      !this.earlyExited &&
      this.rootMaxIndex !== null &&
      this.skipDepth === 0 &&
      this.frameStack.length === 1 &&
      this.frameStack[0].type === "array" &&
      this.frameStack[0].elementIndex >= this.rootMaxIndex &&
      this.activeCaptures.length === 0 &&
      this.activeFilters.length === 0 &&
      this.activeElCollectors.length === 0 &&
      this.pendingSlots.length === 0
    ) {
      this.earlyExited = true;
      if (this.onEarlyExit) {
        this.onEarlyExit();
      }
    }
  }

  private emitResultString(rawJson: string) {
    if (this.hasEmitted) {
      this.emitOutput(`,${rawJson}`);
    } else {
      this.emitOutput(rawJson);
      this.hasEmitted = true;
    }
  }

  private createSlot(streamingCandidate: boolean): PendingSlot {
    const canStream = streamingCandidate && this.pendingSlots.length === 0;
    const slot: PendingSlot = {
      done: false,
      streaming: canStream,
      results: [],
    };
    this.pendingSlots.push(slot);
    return slot;
  }

  private flushPendingSlots() {
    while (this.pendingSlots.length > 0 && this.pendingSlots[0].done) {
      const slot = this.pendingSlots.shift() as PendingSlot;
      if (!slot.streaming) {
        for (let i = 0; i < slot.results.length; i++) {
          this.emitResultString(slot.results[i]);
        }
      }
    }
  }

  private startDirectCapture(): ActiveCapture {
    const slot = this.createSlot(true);
    let startedComma = false;
    const collector = new JsonValueCollector(
      slot.streaming
        ? (token: string) => {
            if (!startedComma) {
              startedComma = true;
              if (this.hasEmitted) {
                this.emitOutput(",");
              }
              this.hasEmitted = true;
            }
            this.emitOutput(token);
          }
        : undefined
    );
    const cap: ActiveCapture = { slot, collector };
    this.activeCaptures.push(cap);
    return cap;
  }

  private startFilterCandidate(
    stepIndex: number,
    step: Extract<JsonPathStep, { kind: "filter" }>,
    nextStepIndex: number
  ): ActiveFilter {
    const slot = this.createSlot(false);
    const proj = this.filterProjections[stepIndex];
    const filter: ActiveFilter = {
      slot,
      collector: proj ? null : new JsonValueCollector(),
      builder: proj ? new PrunedJsBuilder(proj) : null,
      step,
      nextStepIndex,
    };
    this.activeFilters.push(filter);
    return filter;
  }

  private finalizeCapture(cap: ActiveCapture) {
    cap.slot.done = true;
    if (!cap.slot.streaming) {
      cap.slot.results.push(cap.collector.chunks.join(""));
    }
  }

  private finalizeFilter(flt: ActiveFilter) {
    if (flt.builder) {
      const parsed = flt.builder.result;
      if (ConditionEval.evalAst(flt.step.ast, parsed)) {
        const matched = evaluateStepsOnValue(
          parsed,
          this.steps,
          flt.nextStepIndex
        );
        for (let i = 0; i < matched.length; i++) {
          flt.slot.results.push(JSON.stringify(matched[i]));
        }
      }
      flt.slot.done = true;
      return;
    }

    const raw = (flt.collector as JsonValueCollector).chunks.join("");
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    if (ConditionEval.evalAst(flt.step.ast, parsed)) {
      if (flt.nextStepIndex >= this.steps.length) {
        flt.slot.results.push(raw);
      } else {
        const matched = evaluateStepsOnValue(
          parsed,
          this.steps,
          flt.nextStepIndex
        );
        for (let i = 0; i < matched.length; i++) {
          flt.slot.results.push(JSON.stringify(matched[i]));
        }
      }
    }
    flt.slot.done = true;
  }

  private createArrayCollectorForFrame(
    frame: Frame,
    stepIndex: number,
    step: JsonPathStep
  ) {
    let tailKeep: number | null = null;
    let maxCollectIndex: number | null = null;
    if (step.kind === "script" && step.lengthOffset && step.lengthOffset > 0) {
      tailKeep = step.lengthOffset;
    } else if (step.kind === "slice") {
      if (
        step.step > 0 &&
        step.start !== undefined &&
        step.start < 0 &&
        step.end === undefined
      ) {
        tailKeep = -step.start;
      } else if (step.step < 0 && step.end !== undefined && step.end < 0) {
        tailKeep = Math.max(0, -step.end - 1);
      } else if (
        step.step < 0 &&
        step.start !== undefined &&
        step.start >= 0
      ) {
        maxCollectIndex = step.start;
      }
    }
    const slot = this.createSlot(false);
    frame.arrayCollectors.push({
      slot,
      stepIndex,
      step,
      nextStepIndex: stepIndex + 1,
      depth: frame.depth,
      tailKeep,
      maxCollectIndex,
      totalCount: 0,
      elements: [],
      currentElementCollector: null,
    });
  }

  private finalizeArrayCollector(ac: ActiveArrayCollector) {
    const length = ac.totalCount;
    const matchedIndexes: number[] = [];

    if (ac.step.kind === "script") {
      const idx =
        ac.step.staticIndex !== undefined
          ? ac.step.staticIndex
          : ConditionEval.evalAst(ac.step.ast, { length });
      if (
        typeof idx === "number" &&
        Number.isInteger(idx) &&
        idx >= 0 &&
        idx < length
      ) {
        matchedIndexes.push(idx);
      }
    } else if (ac.step.kind === "index") {
      const targetSet = new Set<number>();
      for (const rawIdx of ac.step.rawIndexes) {
        const resolved = rawIdx < 0 ? length + rawIdx : rawIdx;
        if (resolved >= 0 && resolved < length) {
          targetSet.add(resolved);
        }
      }
      for (let i = 0; i < length; i++) {
        if (targetSet.has(i)) {
          matchedIndexes.push(i);
        }
      }
    } else if (ac.step.kind === "slice" && ac.step.step !== 0) {
      const { lower, upper } = resolveSliceBounds(
        length,
        ac.step.start,
        ac.step.end,
        ac.step.step
      );
      if (ac.step.step > 0) {
        for (let i = lower; i < upper; i += ac.step.step) {
          matchedIndexes.push(i);
        }
      } else {
        for (let i = upper; i > lower; i += ac.step.step) {
          matchedIndexes.push(i);
        }
      }
    }

    const baseOffset =
      ac.tailKeep !== null ? Math.max(0, length - ac.tailKeep) : 0;
    for (let i = 0; i < matchedIndexes.length; i++) {
      const arrIdx = matchedIndexes[i] - baseOffset;
      if (arrIdx < 0 || arrIdx >= ac.elements.length) {
        continue;
      }
      const rawEl = ac.elements[arrIdx];
      if (ac.nextStepIndex >= this.steps.length) {
        ac.slot.results.push(rawEl);
      } else {
        const parsedEl = JSON.parse(rawEl);
        const sub = evaluateStepsOnValue(
          parsedEl,
          this.steps,
          ac.nextStepIndex
        );
        for (let j = 0; j < sub.length; j++) {
          ac.slot.results.push(JSON.stringify(sub[j]));
        }
      }
    }
    ac.slot.done = true;
  }

  private pushCollectedElement(ac: ActiveArrayCollector, rawEl: string) {
    ac.totalCount++;
    if (ac.tailKeep !== null) {
      if (ac.tailKeep === 0) {
        return;
      }
      if (ac.elements.length >= ac.tailKeep) {
        ac.elements.shift();
      }
      ac.elements.push(rawEl);
    } else {
      ac.elements.push(rawEl);
    }
  }

  private handleObjectKey(frame: Frame, keyNode: string) {
    frame.pendingChildSteps.length = 0;
    const activeSteps = frame.activeSteps;
    if (activeSteps.length === 0) {
      return;
    }

    const keyStr = unquoteJsonString(keyNode);

    for (let i = 0; i < activeSteps.length; i++) {
      const stepIdx = activeSteps[i];
      const step = this.steps[stepIdx];
      let matched = false;

      if (step.kind === "child" && step.key === keyStr) {
        matched = true;
      } else if (step.kind === "unionKeys" && step.keys.has(keyStr)) {
        matched = true;
      } else if (step.kind === "wildcard") {
        matched = true;
      } else if (step.kind === "filter") {
        this.startFilterCandidate(stepIdx, step, stepIdx + 1);
      }

      if (matched) {
        const nextIdx = stepIdx + 1;
        if (nextIdx >= this.steps.length) {
          this.startDirectCapture();
        } else {
          pushUnique(frame.pendingChildSteps, nextIdx);
        }
      }

      if (step.recursive) {
        pushUnique(frame.pendingChildSteps, stepIdx);
      }
    }
  }

  private evaluateArrayElementSteps(
    frame: Frame,
    isScalar: boolean,
    scalarNode?: string
  ): number[] {
    frame.elementIndex++;
    const idx = frame.elementIndex;
    const elementSteps: number[] = [];

    const frameCols = frame.arrayCollectors;
    for (let i = 0; i < frameCols.length; i++) {
      const ac = frameCols[i];
      if (
        ac.tailKeep === 0 ||
        (ac.maxCollectIndex !== null && idx > ac.maxCollectIndex)
      ) {
        ac.totalCount++;
      } else if (isScalar && scalarNode !== undefined) {
        this.pushCollectedElement(ac, scalarNode);
      } else {
        ac.currentElementCollector = new JsonValueCollector();
        this.activeElCollectors.push(ac);
      }
    }

    const activeSteps = frame.activeSteps;
    for (let i = 0; i < activeSteps.length; i++) {
      const stepIdx = activeSteps[i];
      const step = this.steps[stepIdx];
      let matched = false;

      if (step.kind === "index") {
        if (!step.rawIndexes.some((n) => n < 0) && step.indexes.has(idx)) {
          matched = true;
        }
      } else if (step.kind === "slice") {
        const hasNeg =
          step.step <= 0 ||
          (step.start !== undefined && step.start < 0) ||
          (step.end !== undefined && step.end < 0);
        if (!hasNeg) {
          const start = step.start !== undefined ? step.start : 0;
          if (
            idx >= start &&
            (step.end === undefined || idx < step.end) &&
            (idx - start) % step.step === 0
          ) {
            matched = true;
          }
        }
      } else if (step.kind === "script" && step.staticIndex !== undefined) {
        if (idx === step.staticIndex) {
          matched = true;
        }
      } else if (step.kind === "wildcard") {
        matched = true;
      } else if (step.kind === "filter") {
        if (isScalar && scalarNode !== undefined) {
          let parsed: any;
          try {
            parsed = JSON.parse(scalarNode);
          } catch {
            parsed = undefined;
          }
          if (ConditionEval.evalAst(step.ast, parsed)) {
            const nextIdx = stepIdx + 1;
            if (nextIdx >= this.steps.length) {
              const slot = this.createSlot(false);
              slot.results.push(scalarNode);
              slot.done = true;
            } else {
              const sub = evaluateStepsOnValue(parsed, this.steps, nextIdx);
              if (sub.length > 0) {
                const slot = this.createSlot(false);
                for (let k = 0; k < sub.length; k++) {
                  slot.results.push(JSON.stringify(sub[k]));
                }
                slot.done = true;
              }
            }
          }
        } else {
          this.startFilterCandidate(stepIdx, step, stepIdx + 1);
        }
      }

      if (matched) {
        const nextIdx = stepIdx + 1;
        if (nextIdx >= this.steps.length) {
          if (isScalar && scalarNode !== undefined) {
            const slot = this.createSlot(true);
            if (slot.streaming) {
              this.emitResultString(scalarNode);
            } else {
              slot.results.push(scalarNode);
            }
            slot.done = true;
          } else {
            this.startDirectCapture();
          }
        } else {
          pushUnique(elementSteps, nextIdx);
        }
      }

      if (step.recursive) {
        pushUnique(elementSteps, stepIdx);
      }
    }

    return elementSteps;
  }

  onopenobject(keyNode?: string) {
    if (this.skipDepth > 0) {
      if (!this.skipDecode) {
        for (let i = 0; i < this.activeCaptures.length; i++) {
          this.activeCaptures[i].collector.openObject(keyNode);
        }
        for (let i = 0; i < this.activeFilters.length; i++) {
          const flt = this.activeFilters[i];
          if (flt.builder) flt.builder.openObject(keyNode);
          else (flt.collector as JsonValueCollector).openObject(keyNode);
        }
        for (let i = 0; i < this.activeElCollectors.length; i++) {
          this.activeElCollectors[i].currentElementCollector?.openObject(
            keyNode
          );
        }
        if (this.activeFilters.length > 0) {
          this.updateSkipDecode();
        }
      } else if (this.activeFilters.length > 0) {
        for (let i = 0; i < this.activeFilters.length; i++) {
          this.activeFilters[i].builder?.openObject(keyNode);
        }
        this.updateSkipDecode();
      }
      this.skipDepth++;
      return;
    }

    // 1. Forward to already-active captures, filters, and array element collectors
    const prevCaptureCount = this.activeCaptures.length;
    const prevFilterCount = this.activeFilters.length;
    const prevElColCount = this.activeElCollectors.length;

    for (let i = 0; i < prevCaptureCount; i++) {
      this.activeCaptures[i].collector.openObject(keyNode);
    }
    for (let i = 0; i < prevFilterCount; i++) {
      const flt = this.activeFilters[i];
      if (flt.builder) flt.builder.openObject(keyNode);
      else (flt.collector as JsonValueCollector).openObject(keyNode);
    }
    for (let i = 0; i < prevElColCount; i++) {
      this.activeElCollectors[i].currentElementCollector?.openObject(keyNode);
    }

    // 2. Determine incoming steps for this new object
    let incomingSteps: number[];
    const parent = this.frameStack[this.frameStack.length - 1];
    if (!parent) {
      incomingSteps = this.rootPendingSteps;
      this.rootPendingSteps = [];
    } else if (parent.type === "object") {
      incomingSteps = parent.pendingChildSteps;
      parent.pendingChildSteps = [];
    } else {
      incomingSteps = this.evaluateArrayElementSteps(parent, false);
      for (let i = prevCaptureCount; i < this.activeCaptures.length; i++) {
        this.activeCaptures[i].collector.openObject(keyNode);
      }
      for (let i = prevFilterCount; i < this.activeFilters.length; i++) {
        const flt = this.activeFilters[i];
        if (flt.builder) flt.builder.openObject(keyNode);
        else (flt.collector as JsonValueCollector).openObject(keyNode);
      }
      for (let i = prevElColCount; i < this.activeElCollectors.length; i++) {
        this.activeElCollectors[i].currentElementCollector?.openObject(keyNode);
      }
    }

    if (incomingSteps.length === 0) {
      this.skipDepth = 1;
      this.updateSkipDecode();
      return;
    }

    // 3. Push object frame
    const frame: Frame = {
      type: "object",
      depth: this.frameStack.length + 1,
      activeSteps: incomingSteps,
      elementIndex: -1,
      pendingChildSteps: [],
      arrayCollectors: [],
    };
    this.frameStack.push(frame);

    // 4. Process first key if object is non-empty
    if (keyNode !== undefined) {
      this.handleObjectKey(frame, keyNode);
    }
  }

  oncloseobject() {
    if (this.skipDepth > 0) {
      this.skipDepth--;
      if (this.skipDecode && this.activeFilters.length === 0) {
        if (this.skipDepth === 0) {
          this.updateSkipDecode();
          this.checkEarlyExit();
        }
        return;
      }
      this.advanceCloseObjectOnActive();
      this.updateSkipDecode();
      this.flushPendingSlots();
      this.checkEarlyExit();
      return;
    }

    this.frameStack.pop();
    this.advanceCloseObjectOnActive();
    this.updateSkipDecode();
    this.flushPendingSlots();
    this.checkEarlyExit();
  }

  private advanceCloseObjectOnActive() {
    const capLen = this.activeCaptures.length;
    if (capLen > 0) {
      let writeIdx = 0;
      for (let i = 0; i < capLen; i++) {
        const cap = this.activeCaptures[i];
        cap.collector.closeObject();
        if (cap.collector.done) {
          this.finalizeCapture(cap);
        } else {
          this.activeCaptures[writeIdx++] = cap;
        }
      }
      this.activeCaptures.length = writeIdx;
    }

    const fltLen = this.activeFilters.length;
    if (fltLen > 0) {
      let writeIdx = 0;
      for (let i = 0; i < fltLen; i++) {
        const flt = this.activeFilters[i];
        if (flt.builder) {
          flt.builder.closeObject();
          if (flt.builder.done) {
            this.finalizeFilter(flt);
          } else {
            this.activeFilters[writeIdx++] = flt;
          }
        } else {
          const col = flt.collector as JsonValueCollector;
          col.closeObject();
          if (col.done) {
            this.finalizeFilter(flt);
          } else {
            this.activeFilters[writeIdx++] = flt;
          }
        }
      }
      this.activeFilters.length = writeIdx;
    }

    const elLen = this.activeElCollectors.length;
    if (elLen > 0) {
      let writeIdx = 0;
      for (let i = 0; i < elLen; i++) {
        const ac = this.activeElCollectors[i];
        const col = ac.currentElementCollector as JsonValueCollector;
        col.closeObject();
        if (col.done) {
          this.pushCollectedElement(ac, col.chunks.join(""));
          ac.currentElementCollector = null;
        } else {
          this.activeElCollectors[writeIdx++] = ac;
        }
      }
      this.activeElCollectors.length = writeIdx;
    }
  }

  onopenarray() {
    if (this.skipDepth > 0) {
      if (!this.skipDecode) {
        for (let i = 0; i < this.activeCaptures.length; i++) {
          this.activeCaptures[i].collector.openArray();
        }
        for (let i = 0; i < this.activeFilters.length; i++) {
          const flt = this.activeFilters[i];
          if (flt.builder) flt.builder.openArray();
          else (flt.collector as JsonValueCollector).openArray();
        }
        for (let i = 0; i < this.activeElCollectors.length; i++) {
          this.activeElCollectors[i].currentElementCollector?.openArray();
        }
        if (this.activeFilters.length > 0) {
          this.updateSkipDecode();
        }
      } else if (this.activeFilters.length > 0) {
        for (let i = 0; i < this.activeFilters.length; i++) {
          this.activeFilters[i].builder?.openArray();
        }
        this.updateSkipDecode();
      }
      this.skipDepth++;
      return;
    }

    // 1. Forward to already-active captures, filters, and array element collectors
    const prevCaptureCount = this.activeCaptures.length;
    const prevFilterCount = this.activeFilters.length;
    const prevElColCount = this.activeElCollectors.length;

    for (let i = 0; i < prevCaptureCount; i++) {
      this.activeCaptures[i].collector.openArray();
    }
    for (let i = 0; i < prevFilterCount; i++) {
      const flt = this.activeFilters[i];
      if (flt.builder) flt.builder.openArray();
      else (flt.collector as JsonValueCollector).openArray();
    }
    for (let i = 0; i < prevElColCount; i++) {
      this.activeElCollectors[i].currentElementCollector?.openArray();
    }

    // 2. Determine incoming steps for this new array
    let incomingSteps: number[];
    const parent = this.frameStack[this.frameStack.length - 1];
    if (!parent) {
      incomingSteps = this.rootPendingSteps;
      this.rootPendingSteps = [];
    } else if (parent.type === "object") {
      incomingSteps = parent.pendingChildSteps;
      parent.pendingChildSteps = [];
    } else {
      incomingSteps = this.evaluateArrayElementSteps(parent, false);
      for (let i = prevCaptureCount; i < this.activeCaptures.length; i++) {
        this.activeCaptures[i].collector.openArray();
      }
      for (let i = prevFilterCount; i < this.activeFilters.length; i++) {
        const flt = this.activeFilters[i];
        if (flt.builder) flt.builder.openArray();
        else (flt.collector as JsonValueCollector).openArray();
      }
      for (let i = prevElColCount; i < this.activeElCollectors.length; i++) {
        this.activeElCollectors[i].currentElementCollector?.openArray();
      }
    }

    if (incomingSteps.length === 0) {
      this.skipDepth = 1;
      this.updateSkipDecode();
      return;
    }

    // 3. Push array frame & attach any dynamic array collectors (e.g. @.length, negative slice/index)
    const frame: Frame = {
      type: "array",
      depth: this.frameStack.length + 1,
      activeSteps: incomingSteps,
      elementIndex: -1,
      pendingChildSteps: [],
      arrayCollectors: [],
    };
    this.frameStack.push(frame);

    for (let i = 0; i < incomingSteps.length; i++) {
      const stepIdx = incomingSteps[i];
      const step = this.steps[stepIdx];
      const needsArrayCollector =
        (step.kind === "script" && step.staticIndex === undefined) ||
        (step.kind === "index" && step.rawIndexes.some((n) => n < 0)) ||
        (step.kind === "slice" &&
          step.step !== 0 &&
          (step.step < 0 ||
            (step.start !== undefined && step.start < 0) ||
            (step.end !== undefined && step.end < 0)));
      if (needsArrayCollector) {
        this.createArrayCollectorForFrame(frame, stepIdx, step);
      }
    }
  }

  onclosearray() {
    if (this.skipDepth > 0) {
      this.skipDepth--;
      if (this.skipDecode && this.activeFilters.length === 0) {
        if (this.skipDepth === 0) {
          this.updateSkipDecode();
          this.checkEarlyExit();
        }
        return;
      }
      this.advanceCloseArrayOnActive();
      this.updateSkipDecode();
      this.flushPendingSlots();
      this.checkEarlyExit();
      return;
    }

    const closedFrame = this.frameStack.pop();
    this.advanceCloseArrayOnActive();

    if (closedFrame && closedFrame.arrayCollectors.length > 0) {
      for (let i = 0; i < closedFrame.arrayCollectors.length; i++) {
        this.finalizeArrayCollector(closedFrame.arrayCollectors[i]);
      }
    }

    this.updateSkipDecode();
    this.flushPendingSlots();
    this.checkEarlyExit();
  }

  private advanceCloseArrayOnActive() {
    const capLen = this.activeCaptures.length;
    if (capLen > 0) {
      let writeIdx = 0;
      for (let i = 0; i < capLen; i++) {
        const cap = this.activeCaptures[i];
        cap.collector.closeArray();
        if (cap.collector.done) {
          this.finalizeCapture(cap);
        } else {
          this.activeCaptures[writeIdx++] = cap;
        }
      }
      this.activeCaptures.length = writeIdx;
    }

    const fltLen = this.activeFilters.length;
    if (fltLen > 0) {
      let writeIdx = 0;
      for (let i = 0; i < fltLen; i++) {
        const flt = this.activeFilters[i];
        if (flt.builder) {
          flt.builder.closeArray();
          if (flt.builder.done) {
            this.finalizeFilter(flt);
          } else {
            this.activeFilters[writeIdx++] = flt;
          }
        } else {
          const col = flt.collector as JsonValueCollector;
          col.closeArray();
          if (col.done) {
            this.finalizeFilter(flt);
          } else {
            this.activeFilters[writeIdx++] = flt;
          }
        }
      }
      this.activeFilters.length = writeIdx;
    }

    const elLen = this.activeElCollectors.length;
    if (elLen > 0) {
      let writeIdx = 0;
      for (let i = 0; i < elLen; i++) {
        const ac = this.activeElCollectors[i];
        const col = ac.currentElementCollector as JsonValueCollector;
        col.closeArray();
        if (col.done) {
          this.pushCollectedElement(ac, col.chunks.join(""));
          ac.currentElementCollector = null;
        } else {
          this.activeElCollectors[writeIdx++] = ac;
        }
      }
      this.activeElCollectors.length = writeIdx;
    }
  }

  onkey(keyNode: string) {
    if (this.skipDepth > 0) {
      if (this.skipDecode) {
        return;
      }
      for (let i = 0; i < this.activeCaptures.length; i++) {
        this.activeCaptures[i].collector.key(keyNode);
      }
      for (let i = 0; i < this.activeFilters.length; i++) {
        const flt = this.activeFilters[i];
        if (flt.builder) flt.builder.key(keyNode);
        else (flt.collector as JsonValueCollector).key(keyNode);
      }
      for (let i = 0; i < this.activeElCollectors.length; i++) {
        this.activeElCollectors[i].currentElementCollector?.key(keyNode);
      }
      if (this.activeFilters.length > 0) {
        this.updateSkipDecode();
      }
      return;
    }

    for (let i = 0; i < this.activeCaptures.length; i++) {
      this.activeCaptures[i].collector.key(keyNode);
    }
    for (let i = 0; i < this.activeFilters.length; i++) {
      const flt = this.activeFilters[i];
      if (flt.builder) flt.builder.key(keyNode);
      else (flt.collector as JsonValueCollector).key(keyNode);
    }
    for (let i = 0; i < this.activeElCollectors.length; i++) {
      this.activeElCollectors[i].currentElementCollector?.key(keyNode);
    }

    const top = this.frameStack[this.frameStack.length - 1];
    if (top && top.type === "object") {
      this.handleObjectKey(top, keyNode);
    }
  }

  onvalue(valNode: string) {
    if (this.skipDepth > 0) {
      if (this.skipDecode && this.activeFilters.length === 0) {
        return;
      }
      this.advanceValueOnActive(valNode);
      this.updateSkipDecode();
      this.flushPendingSlots();
      return;
    }

    this.advanceValueOnActive(valNode);

    const top = this.frameStack[this.frameStack.length - 1];
    if (top && top.type === "object") {
      top.pendingChildSteps.length = 0;
    } else if (top && top.type === "array") {
      this.evaluateArrayElementSteps(top, true, valNode);
    }

    this.updateSkipDecode();
    this.flushPendingSlots();
    this.checkEarlyExit();
  }

  private advanceValueOnActive(valNode: string) {
    const capLen = this.activeCaptures.length;
    if (capLen > 0) {
      let writeIdx = 0;
      for (let i = 0; i < capLen; i++) {
        const cap = this.activeCaptures[i];
        cap.collector.value(valNode);
        if (cap.collector.done) {
          this.finalizeCapture(cap);
        } else {
          this.activeCaptures[writeIdx++] = cap;
        }
      }
      this.activeCaptures.length = writeIdx;
    }

    const fltLen = this.activeFilters.length;
    if (fltLen > 0) {
      let writeIdx = 0;
      for (let i = 0; i < fltLen; i++) {
        const flt = this.activeFilters[i];
        if (flt.builder) {
          flt.builder.value(valNode);
          if (flt.builder.done) {
            this.finalizeFilter(flt);
          } else {
            this.activeFilters[writeIdx++] = flt;
          }
        } else {
          const col = flt.collector as JsonValueCollector;
          col.value(valNode);
          if (col.done) {
            this.finalizeFilter(flt);
          } else {
            this.activeFilters[writeIdx++] = flt;
          }
        }
      }
      this.activeFilters.length = writeIdx;
    }

    const elLen = this.activeElCollectors.length;
    if (elLen > 0) {
      let writeIdx = 0;
      for (let i = 0; i < elLen; i++) {
        const ac = this.activeElCollectors[i];
        const col = ac.currentElementCollector as JsonValueCollector;
        col.value(valNode);
        if (col.done) {
          this.pushCollectedElement(ac, col.chunks.join(""));
          ac.currentElementCollector = null;
        } else {
          this.activeElCollectors[writeIdx++] = ac;
        }
      }
      this.activeElCollectors.length = writeIdx;
    }
  }
}
