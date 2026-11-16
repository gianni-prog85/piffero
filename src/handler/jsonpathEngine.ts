import { ConditionEval, ExprNode } from "../conditioneval/conditioneval";

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

  // Filter expression: ?(...)
  if (inner.startsWith("?")) {
    if (inner.length < 4 || inner[1] !== "(") {
      throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
    }
    const closeParen = findMatchingBracket(inner, 1, "(", ")");
    if (closeParen !== inner.length - 1) {
      throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
    }
    const expr = inner.slice(2, -1).trim();
    if (!expr) {
      throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
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
    if (step <= 0) {
      throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
    }
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
        ...(isMulti ? {} : { end: 0, step: 1 }),
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
      const hasNegative =
        (step.start !== undefined && step.start < 0) ||
        (step.end !== undefined && step.end < 0);
      if (hasNegative || hasNext || !canAttachToCurrent) {
        needsStreamingEngine = true;
      }
      const range = {
        start: step.start !== undefined ? step.start : 0,
        end: step.end !== undefined ? step.end : 0,
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
  end?: number
): { s: number; e: number } {
  let s = start === undefined ? 0 : start < 0 ? Math.max(0, length + start) : start;
  let e: number;
  if (end === undefined || end === 0) {
    e = length;
  } else if (end < 0) {
    e = Math.max(0, length + end);
  } else {
    e = Math.min(length, end);
  }
  return { s, e };
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
      if (Array.isArray(val)) {
        const { s, e } = resolveSliceBounds(val.length, step.start, step.end);
        for (let i = s; i < e; i += step.step) {
          results.push(...evaluateStepsOnValue(val[i], steps, nextIndex, rootValue));
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
    if (parent && parent.type === "array" && parent.hasItem) {
      this.emit(",");
    }
    if (parent) {
      parent.hasItem = true;
    }
    this.emit("{");
    const entry: CaptureStackEntry = { type: "object", hasItem: false };
    this.stack.push(entry);
    if (keyNode !== undefined) {
      this.emit(`${keyNode}:`);
      entry.hasItem = true;
    }
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
    if (parent && parent.type === "array" && parent.hasItem) {
      this.emit(",");
    }
    if (parent) {
      parent.hasItem = true;
    }
    this.emit("[");
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
      this.emit(",");
    }
    top.hasItem = true;
    this.emit(`${keyNode}:`);
  }

  value(valNode: string) {
    const top = this.stack[this.stack.length - 1];
    if (top && top.type === "array" && top.hasItem) {
      this.emit(",");
    }
    if (top) {
      top.hasItem = true;
    }
    this.emit(valNode);
    if (this.stack.length === 0) {
      this.done = true;
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
  collector: JsonValueCollector;
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

export class StreamingPathEngine {
  private frameStack: Frame[] = [];
  private pendingSlots: PendingSlot[] = [];
  private activeCaptures: ActiveCapture[] = [];
  private activeFilters: ActiveFilter[] = [];
  private hasEmitted = false;
  private rootPendingSteps: number[] = [];

  constructor(
    private steps: JsonPathStep[],
    private emitOutput: (chunk: string) => void
  ) {
    if (steps.length > 0) {
      this.rootPendingSteps = [0];
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
    step: Extract<JsonPathStep, { kind: "filter" }>,
    nextStepIndex: number
  ): ActiveFilter {
    const slot = this.createSlot(false);
    const filter: ActiveFilter = {
      slot,
      collector: new JsonValueCollector(),
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
    const raw = flt.collector.chunks.join("");
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
    if (step.kind === "script" && step.lengthOffset && step.lengthOffset > 0) {
      tailKeep = step.lengthOffset;
    } else if (
      step.kind === "slice" &&
      step.start !== undefined &&
      step.start < 0 &&
      (step.end === undefined || step.end === 0)
    ) {
      tailKeep = -step.start;
    }
    const slot = this.createSlot(false);
    frame.arrayCollectors.push({
      slot,
      stepIndex,
      step,
      nextStepIndex: stepIndex + 1,
      depth: frame.depth,
      tailKeep,
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
    } else if (ac.step.kind === "slice") {
      const { s, e } = resolveSliceBounds(length, ac.step.start, ac.step.end);
      for (let i = s; i < e; i += ac.step.step) {
        matchedIndexes.push(i);
      }
    }

    const baseOffset = ac.tailKeep !== null ? Math.max(0, length - ac.tailKeep) : 0;
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
        const sub = evaluateStepsOnValue(parsedEl, this.steps, ac.nextStepIndex);
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
      if (ac.elements.length >= ac.tailKeep) {
        ac.elements.shift();
      }
      ac.elements.push(rawEl);
    } else {
      ac.elements.push(rawEl);
    }
  }

  private collectActiveElementCollectors(): ActiveArrayCollector[] {
    const out: ActiveArrayCollector[] = [];
    for (let i = 0; i < this.frameStack.length; i++) {
      const cols = this.frameStack[i].arrayCollectors;
      for (let j = 0; j < cols.length; j++) {
        if (cols[j].currentElementCollector) {
          out.push(cols[j]);
        }
      }
    }
    return out;
  }

  private handleObjectKey(frame: Frame, keyNode: string) {
    let keyStr: string;
    try {
      keyStr = JSON.parse(keyNode);
    } catch {
      keyStr = keyNode.slice(1, -1);
    }
    frame.pendingChildSteps = [];

    const newCaptures: ActiveCapture[] = [];
    const newFilters: ActiveFilter[] = [];

    for (let i = 0; i < frame.activeSteps.length; i++) {
      const stepIdx = frame.activeSteps[i];
      const step = this.steps[stepIdx];
      let matched = false;

      if (step.kind === "child" && step.key === keyStr) {
        matched = true;
      } else if (step.kind === "unionKeys" && step.keys.has(keyStr)) {
        matched = true;
      } else if (step.kind === "wildcard") {
        matched = true;
      } else if (step.kind === "filter") {
        // Object member value filter
        newFilters.push(this.startFilterCandidate(step, stepIdx + 1));
      }

      if (matched) {
        const nextIdx = stepIdx + 1;
        if (nextIdx >= this.steps.length) {
          newCaptures.push(this.startDirectCapture());
        } else {
          pushUnique(frame.pendingChildSteps, nextIdx);
        }
      }

      if (step.recursive) {
        pushUnique(frame.pendingChildSteps, stepIdx);
      }
    }
    // Note: newCaptures and newFilters wait for the NEXT event (the property's value).
    void newCaptures;
    void newFilters;
  }

  private evaluateArrayElementSteps(
    frame: Frame,
    isScalar: boolean,
    scalarNode?: string
  ): {
    elementSteps: number[];
    newCaptures: ActiveCapture[];
    newFilters: ActiveFilter[];
    newElementCollectors: ActiveArrayCollector[];
  } {
    frame.elementIndex++;
    const idx = frame.elementIndex;
    const elementSteps: number[] = [];
    const newCaptures: ActiveCapture[] = [];
    const newFilters: ActiveFilter[] = [];
    const newElementCollectors: ActiveArrayCollector[] = [];

    for (let i = 0; i < frame.arrayCollectors.length; i++) {
      const ac = frame.arrayCollectors[i];
      if (isScalar && scalarNode !== undefined) {
        this.pushCollectedElement(ac, scalarNode);
      } else {
        ac.currentElementCollector = new JsonValueCollector();
        newElementCollectors.push(ac);
      }
    }

    for (let i = 0; i < frame.activeSteps.length; i++) {
      const stepIdx = frame.activeSteps[i];
      const step = this.steps[stepIdx];
      let matched = false;

      if (step.kind === "index") {
        if (!step.rawIndexes.some((n) => n < 0) && step.indexes.has(idx)) {
          matched = true;
        }
      } else if (step.kind === "slice") {
        const hasNeg =
          (step.start !== undefined && step.start < 0) ||
          (step.end !== undefined && step.end < 0);
        if (!hasNeg) {
          const start = step.start !== undefined ? step.start : 0;
          const end = step.end !== undefined ? step.end : 0;
          if (idx >= start && (end <= 0 || idx < end) && (idx - start) % step.step === 0) {
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
          newFilters.push(this.startFilterCandidate(step, stepIdx + 1));
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
            newCaptures.push(this.startDirectCapture());
          }
        } else {
          pushUnique(elementSteps, nextIdx);
        }
      }

      if (step.recursive) {
        pushUnique(elementSteps, stepIdx);
      }
    }

    return { elementSteps, newCaptures, newFilters, newElementCollectors };
  }

  onopenobject(keyNode?: string) {
    // 1. Forward to already-active captures, filters, and array element collectors
    for (let i = 0; i < this.activeCaptures.length; i++) {
      this.activeCaptures[i].collector.openObject(keyNode);
    }
    for (let i = 0; i < this.activeFilters.length; i++) {
      this.activeFilters[i].collector.openObject(keyNode);
    }
    const existingElCols = this.collectActiveElementCollectors();
    for (let i = 0; i < existingElCols.length; i++) {
      existingElCols[i].currentElementCollector?.openObject(keyNode);
    }

    // 2. Determine incoming steps for this new object
    let incomingSteps: number[] = [];
    const parent = this.frameStack[this.frameStack.length - 1];
    if (!parent) {
      incomingSteps = this.rootPendingSteps.slice();
      this.rootPendingSteps = [];
    } else if (parent.type === "object") {
      incomingSteps = parent.pendingChildSteps.slice();
      parent.pendingChildSteps = [];
    } else {
      const res = this.evaluateArrayElementSteps(parent, false);
      incomingSteps = res.elementSteps;
      for (let i = 0; i < res.newCaptures.length; i++) {
        res.newCaptures[i].collector.openObject(keyNode);
      }
      for (let i = 0; i < res.newFilters.length; i++) {
        res.newFilters[i].collector.openObject(keyNode);
      }
      for (let i = 0; i < res.newElementCollectors.length; i++) {
        res.newElementCollectors[i].currentElementCollector?.openObject(keyNode);
      }
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
    this.frameStack.pop();

    const remainingCaptures: ActiveCapture[] = [];
    for (let i = 0; i < this.activeCaptures.length; i++) {
      const cap = this.activeCaptures[i];
      cap.collector.closeObject();
      if (cap.collector.done) {
        this.finalizeCapture(cap);
      } else {
        remainingCaptures.push(cap);
      }
    }
    this.activeCaptures = remainingCaptures;

    const remainingFilters: ActiveFilter[] = [];
    for (let i = 0; i < this.activeFilters.length; i++) {
      const flt = this.activeFilters[i];
      flt.collector.closeObject();
      if (flt.collector.done) {
        this.finalizeFilter(flt);
      } else {
        remainingFilters.push(flt);
      }
    }
    this.activeFilters = remainingFilters;

    const elCols = this.collectActiveElementCollectors();
    for (let i = 0; i < elCols.length; i++) {
      const ac = elCols[i];
      const col = ac.currentElementCollector as JsonValueCollector;
      col.closeObject();
      if (col.done) {
        this.pushCollectedElement(ac, col.chunks.join(""));
        ac.currentElementCollector = null;
      }
    }

    this.flushPendingSlots();
  }

  onopenarray() {
    // 1. Forward to already-active captures, filters, and array element collectors
    for (let i = 0; i < this.activeCaptures.length; i++) {
      this.activeCaptures[i].collector.openArray();
    }
    for (let i = 0; i < this.activeFilters.length; i++) {
      this.activeFilters[i].collector.openArray();
    }
    const existingElCols = this.collectActiveElementCollectors();
    for (let i = 0; i < existingElCols.length; i++) {
      existingElCols[i].currentElementCollector?.openArray();
    }

    // 2. Determine incoming steps for this new array
    let incomingSteps: number[] = [];
    const parent = this.frameStack[this.frameStack.length - 1];
    if (!parent) {
      incomingSteps = this.rootPendingSteps.slice();
      this.rootPendingSteps = [];
    } else if (parent.type === "object") {
      incomingSteps = parent.pendingChildSteps.slice();
      parent.pendingChildSteps = [];
    } else {
      const res = this.evaluateArrayElementSteps(parent, false);
      incomingSteps = res.elementSteps;
      for (let i = 0; i < res.newCaptures.length; i++) {
        res.newCaptures[i].collector.openArray();
      }
      for (let i = 0; i < res.newFilters.length; i++) {
        res.newFilters[i].collector.openArray();
      }
      for (let i = 0; i < res.newElementCollectors.length; i++) {
        res.newElementCollectors[i].currentElementCollector?.openArray();
      }
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
          ((step.start !== undefined && step.start < 0) ||
            (step.end !== undefined && step.end < 0)));
      if (needsArrayCollector) {
        this.createArrayCollectorForFrame(frame, stepIdx, step);
      }
    }
  }

  onclosearray() {
    const closedFrame = this.frameStack.pop();

    const remainingCaptures: ActiveCapture[] = [];
    for (let i = 0; i < this.activeCaptures.length; i++) {
      const cap = this.activeCaptures[i];
      cap.collector.closeArray();
      if (cap.collector.done) {
        this.finalizeCapture(cap);
      } else {
        remainingCaptures.push(cap);
      }
    }
    this.activeCaptures = remainingCaptures;

    const remainingFilters: ActiveFilter[] = [];
    for (let i = 0; i < this.activeFilters.length; i++) {
      const flt = this.activeFilters[i];
      flt.collector.closeArray();
      if (flt.collector.done) {
        this.finalizeFilter(flt);
      } else {
        remainingFilters.push(flt);
      }
    }
    this.activeFilters = remainingFilters;

    const elCols = this.collectActiveElementCollectors();
    for (let i = 0; i < elCols.length; i++) {
      const ac = elCols[i];
      const col = ac.currentElementCollector as JsonValueCollector;
      col.closeArray();
      if (col.done) {
        this.pushCollectedElement(ac, col.chunks.join(""));
        ac.currentElementCollector = null;
      }
    }

    if (closedFrame && closedFrame.arrayCollectors.length > 0) {
      for (let i = 0; i < closedFrame.arrayCollectors.length; i++) {
        this.finalizeArrayCollector(closedFrame.arrayCollectors[i]);
      }
    }

    this.flushPendingSlots();
  }

  onkey(keyNode: string) {
    for (let i = 0; i < this.activeCaptures.length; i++) {
      this.activeCaptures[i].collector.key(keyNode);
    }
    for (let i = 0; i < this.activeFilters.length; i++) {
      this.activeFilters[i].collector.key(keyNode);
    }
    const elCols = this.collectActiveElementCollectors();
    for (let i = 0; i < elCols.length; i++) {
      elCols[i].currentElementCollector?.key(keyNode);
    }

    const top = this.frameStack[this.frameStack.length - 1];
    if (top && top.type === "object") {
      this.handleObjectKey(top, keyNode);
    }
  }

  onvalue(valNode: string) {
    // 1. Forward to already-active captures, filters, and array element collectors
    const remainingCaptures: ActiveCapture[] = [];
    for (let i = 0; i < this.activeCaptures.length; i++) {
      const cap = this.activeCaptures[i];
      cap.collector.value(valNode);
      if (cap.collector.done) {
        this.finalizeCapture(cap);
      } else {
        remainingCaptures.push(cap);
      }
    }
    this.activeCaptures = remainingCaptures;

    const remainingFilters: ActiveFilter[] = [];
    for (let i = 0; i < this.activeFilters.length; i++) {
      const flt = this.activeFilters[i];
      flt.collector.value(valNode);
      if (flt.collector.done) {
        this.finalizeFilter(flt);
      } else {
        remainingFilters.push(flt);
      }
    }
    this.activeFilters = remainingFilters;

    const elCols = this.collectActiveElementCollectors();
    for (let i = 0; i < elCols.length; i++) {
      const ac = elCols[i];
      const col = ac.currentElementCollector as JsonValueCollector;
      col.value(valNode);
      if (col.done) {
        this.pushCollectedElement(ac, col.chunks.join(""));
        ac.currentElementCollector = null;
      }
    }

    // 2. If inside an array, evaluate array element steps for this scalar!
    const top = this.frameStack[this.frameStack.length - 1];
    if (top && top.type === "object") {
      top.pendingChildSteps = [];
    } else if (top && top.type === "array") {
      this.evaluateArrayElementSteps(top, true, valNode);
    }

    this.flushPendingSlots();
  }
}
