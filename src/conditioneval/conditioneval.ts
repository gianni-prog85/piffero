export type ExprNode =
  | { type: "literal"; value: any }
  | { type: "current" }
  | { type: "root" }
  | { type: "identifier"; name: string }
  | { type: "member"; object: ExprNode; property: string }
  | { type: "index"; object: ExprNode; index: ExprNode }
  | { type: "unary"; op: "!" | "-" | "+"; argument: ExprNode }
  | {
      type: "binary";
      op:
        | "==="
        | "!=="
        | "=="
        | "!="
        | ">="
        | "<="
        | ">"
        | "<"
        | "+"
        | "-"
        | "*"
        | "/"
        | "%";
      left: ExprNode;
      right: ExprNode;
    }
  | { type: "logical"; op: "&&" | "||"; left: ExprNode; right: ExprNode };

interface ExprToken {
  type: "number" | "string" | "ident" | "op" | "at" | "dollar" | "punct";
  value: string;
}

function hasLoneSurrogate(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      if (i + 1 >= str.length) {
        return true;
      }
      const next = str.charCodeAt(i + 1);
      if (next < 0xDC00 || next > 0xDFFF) {
        return true;
      }
      i++;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return true;
    }
  }
  return false;
}

export function decodeJsonPathStringInner(inner: string, quote: string): string {
  if (inner.indexOf("\\") === -1) {
    if (/[\u0000-\u001F]/.test(inner)) {
      throw new Error("Unescaped control character in string literal");
    }
    if (/[\uD800-\uDFFF]/.test(inner) && hasLoneSurrogate(inner)) {
      throw new Error("Lone UTF-16 surrogate in string literal");
    }
    return inner;
  }

  let out = "";
  const len = inner.length;
  for (let i = 0; i < len; i++) {
    const ch = inner[i];
    if (ch === "\\") {
      if (i + 1 >= len) {
        throw new Error("Trailing backslash in string literal");
      }
      const next = inner[++i];
      switch (next) {
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case "n":
          out += "\n";
          break;
        case "r":
          out += "\r";
          break;
        case "t":
          out += "\t";
          break;
        case "/":
          out += "/";
          break;
        case "\\":
          out += "\\";
          break;
        case "'":
          if (quote === '"') {
            throw new Error("Invalid escape \\' in double-quoted string literal");
          }
          out += "'";
          break;
        case '"':
          if (quote === "'") {
            throw new Error('Invalid escape \\" in single-quoted string literal');
          }
          out += '"';
          break;
        case "`":
          if (quote !== "`") {
            throw new Error("Invalid escape \\` in string literal");
          }
          out += "`";
          break;
        case "u": {
          if (i + 4 >= len) {
            throw new Error("Incomplete Unicode escape sequence \\u");
          }
          const hex = inner.slice(i + 1, i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            throw new Error(`Invalid Unicode escape sequence \\u${hex}`);
          }
          const code = parseInt(hex, 16);
          i += 4;
          if (code >= 0xD800 && code <= 0xDBFF) {
            if (i + 6 >= len || inner[i + 1] !== "\\" || inner[i + 2] !== "u") {
              throw new Error(`Lone high surrogate \\u${hex} in string literal`);
            }
            const lowHex = inner.slice(i + 3, i + 7);
            if (!/^[0-9a-fA-F]{4}$/.test(lowHex)) {
              throw new Error(`Invalid Unicode escape sequence \\u${lowHex}`);
            }
            const lowCode = parseInt(lowHex, 16);
            if (lowCode < 0xDC00 || lowCode > 0xDFFF) {
              throw new Error(`Invalid low surrogate \\u${lowHex} in string literal`);
            }
            out += String.fromCharCode(code, lowCode);
            i += 6;
          } else if (code >= 0xDC00 && code <= 0xDFFF) {
            throw new Error(`Lone low surrogate \\u${hex} in string literal`);
          } else {
            out += String.fromCharCode(code);
          }
          break;
        }
        default:
          throw new Error(`Invalid escape sequence \\${next} in string literal`);
      }
    } else {
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        throw new Error("Unescaped control character in string literal");
      }
      if (code >= 0xD800 && code <= 0xDBFF) {
        if (i + 1 >= len) {
          throw new Error("Lone high surrogate in string literal");
        }
        const nextCode = inner.charCodeAt(i + 1);
        if (nextCode < 0xDC00 || nextCode > 0xDFFF) {
          throw new Error("Lone high surrogate in string literal");
        }
        out += ch + inner[++i];
      } else if (code >= 0xDC00 && code <= 0xDFFF) {
        throw new Error("Lone low surrogate in string literal");
      } else {
        out += ch;
      }
    }
  }
  return out;
}

function unescapeStringLiteral(raw: string): string {
  return decodeJsonPathStringInner(raw.slice(1, -1), raw[0]);
}

function tokenizeExpression(expr: string): ExprToken[] {
  const tokens: ExprToken[] = [];
  let i = 0;
  const len = expr.length;

  while (i < len) {
    const ch = expr[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    // String literals
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      let closed = false;
      while (j < len) {
        if (expr[j] === "\\") {
          j += 2;
          continue;
        }
        if (expr[j] === quote) {
          j++;
          closed = true;
          break;
        }
        j++;
      }
      if (!closed) {
        throw new Error(`Unterminated string literal in expression: ${expr}`);
      }
      tokens.push({
        type: "string",
        value: unescapeStringLiteral(expr.slice(i, j)),
      });
      i = j;
      continue;
    }

    // Multi-char operators
    const three = expr.slice(i, i + 3);
    if (three === "===" || three === "!==") {
      tokens.push({ type: "op", value: three });
      i += 3;
      continue;
    }
    const two = expr.slice(i, i + 2);
    if (
      two === "==" ||
      two === "!=" ||
      two === ">=" ||
      two === "<=" ||
      two === "&&" ||
      two === "||"
    ) {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }

    // Numbers
    if (
      (ch >= "0" && ch <= "9") ||
      (ch === "." && i + 1 < len && expr[i + 1] >= "0" && expr[i + 1] <= "9")
    ) {
      const rest = expr.slice(i);
      const m = /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(
        rest
      );
      if (m) {
        tokens.push({ type: "number", value: m[0] });
        i += m[0].length;
        continue;
      }
    }

    if (ch === "@") {
      tokens.push({ type: "at", value: "@" });
      i++;
      continue;
    }

    if (ch === "$") {
      tokens.push({ type: "dollar", value: "$" });
      i++;
      continue;
    }

    if (
      ch === "(" ||
      ch === ")" ||
      ch === "[" ||
      ch === "]" ||
      ch === "."
    ) {
      tokens.push({ type: "punct", value: ch });
      i++;
      continue;
    }

    if (
      ch === ">" ||
      ch === "<" ||
      ch === "+" ||
      ch === "-" ||
      ch === "*" ||
      ch === "/" ||
      ch === "%" ||
      ch === "!"
    ) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }

    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
      let j = i + 1;
      while (
        j < len &&
        ((expr[j] >= "a" && expr[j] <= "z") ||
          (expr[j] >= "A" && expr[j] <= "Z") ||
          (expr[j] >= "0" && expr[j] <= "9") ||
          expr[j] === "_" ||
          expr[j] === "$")
      ) {
        j++;
      }
      tokens.push({ type: "ident", value: expr.slice(i, j) });
      i = j;
      continue;
    }

    throw new Error(`Unexpected token '${ch}' in expression: ${expr}`);
  }

  return tokens;
}

class ExprParser {
  private pos = 0;

  constructor(private tokens: ExprToken[], private raw: string) {}

  parse(): ExprNode {
    if (this.tokens.length === 0) {
      throw new Error(`Empty expression: ${this.raw}`);
    }
    const node = this.parseOr();
    if (this.pos < this.tokens.length) {
      throw new Error(
        `Unexpected token '${this.tokens[this.pos].value}' in expression: ${this.raw}`
      );
    }
    return node;
  }

  private peek(): ExprToken | undefined {
    return this.tokens[this.pos];
  }

  private consume(): ExprToken {
    return this.tokens[this.pos++];
  }

  private parseOr(): ExprNode {
    let left = this.parseAnd();
    while (this.peek()?.type === "op" && this.peek()?.value === "||") {
      this.consume();
      const right = this.parseAnd();
      left = { type: "logical", op: "||", left, right };
    }
    return left;
  }

  private parseAnd(): ExprNode {
    let left = this.parseEquality();
    while (this.peek()?.type === "op" && this.peek()?.value === "&&") {
      this.consume();
      const right = this.parseEquality();
      left = { type: "logical", op: "&&", left, right };
    }
    return left;
  }

  private parseEquality(): ExprNode {
    let left = this.parseRelational();
    while (
      this.peek()?.type === "op" &&
      (this.peek()?.value === "===" ||
        this.peek()?.value === "!==" ||
        this.peek()?.value === "==" ||
        this.peek()?.value === "!=")
    ) {
      const op = this.consume().value as "===" | "!==" | "==" | "!=";
      const right = this.parseRelational();
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  private parseRelational(): ExprNode {
    let left = this.parseAdditive();
    while (
      this.peek()?.type === "op" &&
      (this.peek()?.value === "<" ||
        this.peek()?.value === "<=" ||
        this.peek()?.value === ">" ||
        this.peek()?.value === ">=")
    ) {
      const op = this.consume().value as "<" | "<=" | ">" | ">=";
      const right = this.parseAdditive();
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  private parseAdditive(): ExprNode {
    let left = this.parseMultiplicative();
    while (
      this.peek()?.type === "op" &&
      (this.peek()?.value === "+" || this.peek()?.value === "-")
    ) {
      const op = this.consume().value as "+" | "-";
      const right = this.parseMultiplicative();
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): ExprNode {
    let left = this.parseUnary();
    while (
      this.peek()?.type === "op" &&
      (this.peek()?.value === "*" ||
        this.peek()?.value === "/" ||
        this.peek()?.value === "%")
    ) {
      const op = this.consume().value as "*" | "/" | "%";
      const right = this.parseUnary();
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  private parseUnary(): ExprNode {
    const tok = this.peek();
    if (
      tok &&
      tok.type === "op" &&
      (tok.value === "!" || tok.value === "-" || tok.value === "+")
    ) {
      this.consume();
      return {
        type: "unary",
        op: tok.value as "!" | "-" | "+",
        argument: this.parseUnary(),
      };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): ExprNode {
    let node = this.parsePrimary();
    while (this.peek()?.type === "punct") {
      const p = this.peek().value;
      if (p === ".") {
        this.consume();
        const propTok = this.peek();
        if (!propTok || propTok.type !== "ident") {
          throw new Error(
            `Expected property name after '.' in expression: ${this.raw}`
          );
        }
        this.consume();
        node = { type: "member", object: node, property: propTok.value };
      } else if (p === "[") {
        this.consume();
        const indexExpr = this.parseOr();
        const closeTok = this.peek();
        if (!closeTok || closeTok.type !== "punct" || closeTok.value !== "]") {
          throw new Error(`Expected ']' in expression: ${this.raw}`);
        }
        this.consume();
        node = { type: "index", object: node, index: indexExpr };
      } else {
        break;
      }
    }
    return node;
  }

  private parsePrimary(): ExprNode {
    const tok = this.peek();
    if (!tok) {
      throw new Error(`Unexpected end of expression: ${this.raw}`);
    }

    if (tok.type === "punct" && tok.value === "(") {
      this.consume();
      const inner = this.parseOr();
      const closeTok = this.peek();
      if (!closeTok || closeTok.type !== "punct" || closeTok.value !== ")") {
        throw new Error(`Unclosed '(' in expression: ${this.raw}`);
      }
      this.consume();
      return inner;
    }

    if (tok.type === "at") {
      this.consume();
      return { type: "current" };
    }

    if (tok.type === "dollar") {
      this.consume();
      return { type: "root" };
    }

    if (tok.type === "number") {
      this.consume();
      return { type: "literal", value: Number(tok.value) };
    }

    if (tok.type === "string") {
      this.consume();
      return { type: "literal", value: tok.value };
    }

    if (tok.type === "ident") {
      this.consume();
      if (tok.value === "true") return { type: "literal", value: true };
      if (tok.value === "false") return { type: "literal", value: false };
      if (tok.value === "null") return { type: "literal", value: null };
      if (tok.value === "undefined") return { type: "literal", value: undefined };
      return { type: "identifier", name: tok.value };
    }

    throw new Error(
      `Unexpected token '${tok.value}' in expression: ${this.raw}`
    );
  }
}

export const NOTHING: unique symbol = Symbol("NOTHING");

const hasOwn: (obj: any, key: PropertyKey) => boolean =
  typeof (Object as any).hasOwn === "function"
    ? (Object as any).hasOwn
    : (obj: any, key: PropertyKey) =>
        Object.prototype.hasOwnProperty.call(obj, key);

export function rfc9535Equals(a: any, b: any): boolean {
  if (a === b) {
    return true;
  }
  if (a === NOTHING || b === NOTHING || a === null || b === null) {
    return false;
  }
  if (typeof a !== typeof b || typeof a !== "object") {
    return false;
  }
  const aIsArr = Array.isArray(a);
  if (aIsArr !== Array.isArray(b)) {
    return false;
  }
  if (aIsArr) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!rfc9535Equals(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (let i = 0; i < keysA.length; i++) {
    const k = keysA[i];
    if (!hasOwn(b, k) || !rfc9535Equals(a[k], b[k])) {
      return false;
    }
  }
  return true;
}

function rfc9535LessThan(a: any, b: any): boolean {
  if (typeof a === "number" && typeof b === "number") {
    return a < b;
  }
  if (typeof a === "string" && typeof b === "string") {
    return a < b;
  }
  return false;
}

export class ConditionEval {
  private static astCache = new Map<string, ExprNode>();

  static createCondition(condition: string) {
    const tokens: { type: string; value: string }[] = [];
    const regex =
      /===|!==|==|!=|>=|<=|&&|\|\||[()!.<>+\-*/]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[0-9]+(?:\.[0-9]+)?|[a-zA-Z_$][a-zA-Z0-9_$]*/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(condition)) !== null) {
      const val = match[0];
      let type = "Punctuator";
      if (/^[0-9]/.test(val)) {
        type = "Numeric";
      } else if (
        val.startsWith('"') ||
        val.startsWith("'") ||
        val.startsWith("`")
      ) {
        type = "String";
      } else if (val === "true" || val === "false") {
        type = "Boolean";
      } else if (val === "null") {
        type = "Null";
      } else if (/^[a-zA-Z_$]/.test(val)) {
        type = "Identifier";
      }
      tokens.push({ type, value: val });
    }
    return tokens;
  }

  static compile(expr: string): ExprNode {
    const cached = this.astCache.get(expr);
    if (cached) {
      return cached;
    }
    const tokens = tokenizeExpression(expr);
    const ast = new ExprParser(tokens, expr).parse();
    this.astCache.set(expr, ast);
    return ast;
  }

  private static evalComparison(
    op: "===" | "!==" | "==" | "!=" | ">" | ">=" | "<" | "<=",
    left: any,
    right: any
  ): boolean {
    switch (op) {
      case "===":
        return left === right;
      case "!==":
        return left !== right;
      case "==":
        return (
          left === right ||
          (left !== null &&
            right !== null &&
            typeof left === "object" &&
            typeof right === "object" &&
            rfc9535Equals(left, right))
        );
      case "!=":
        return !(
          left === right ||
          (left !== null &&
            right !== null &&
            typeof left === "object" &&
            typeof right === "object" &&
            rfc9535Equals(left, right))
        );
      case "<":
        return rfc9535LessThan(left, right);
      case "<=":
        return (
          rfc9535LessThan(left, right) ||
          left === right ||
          (left !== null &&
            right !== null &&
            typeof left === "object" &&
            typeof right === "object" &&
            rfc9535Equals(left, right))
        );
      case ">":
        return rfc9535LessThan(right, left);
      case ">=":
        return (
          rfc9535LessThan(right, left) ||
          left === right ||
          (left !== null &&
            right !== null &&
            typeof left === "object" &&
            typeof right === "object" &&
            rfc9535Equals(left, right))
        );
    }
  }

  static evalFilterAst(node: ExprNode, currentValue: any, rootValue?: any): boolean {
    switch (node.type) {
      case "logical": {
        if (node.op === "&&") {
          return (
            this.evalFilterAst(node.left, currentValue, rootValue) &&
            this.evalFilterAst(node.right, currentValue, rootValue)
          );
        }
        return (
          this.evalFilterAst(node.left, currentValue, rootValue) ||
          this.evalFilterAst(node.right, currentValue, rootValue)
        );
      }
      case "unary": {
        if (node.op === "!") {
          return !this.evalFilterAst(node.argument, currentValue, rootValue);
        }
        const val = this.evalAst(node, currentValue, rootValue);
        return val !== NOTHING && Boolean(val);
      }
      case "binary": {
        const left =
          node.left.type === "literal"
            ? node.left.value
            : node.left.type === "current"
            ? currentValue === undefined
              ? NOTHING
              : currentValue
            : this.evalAst(node.left, currentValue, rootValue);
        const right =
          node.right.type === "literal"
            ? node.right.value
            : node.right.type === "current"
            ? currentValue === undefined
              ? NOTHING
              : currentValue
            : this.evalAst(node.right, currentValue, rootValue);
        switch (node.op) {
          case "===":
            return left === right;
          case "!==":
            return left !== right;
          case "==":
            return (
              left === right ||
              (left !== null &&
                right !== null &&
                typeof left === "object" &&
                typeof right === "object" &&
                rfc9535Equals(left, right))
            );
          case "!=":
            return !(
              left === right ||
              (left !== null &&
                right !== null &&
                typeof left === "object" &&
                typeof right === "object" &&
                rfc9535Equals(left, right))
            );
          case "<":
            return (typeof left === "number" && typeof right === "number") ||
              (typeof left === "string" && typeof right === "string")
              ? left < right
              : false;
          case "<=":
            return (
              ((typeof left === "number" && typeof right === "number") ||
              (typeof left === "string" && typeof right === "string")
                ? left < right
                : false) ||
              left === right ||
              (left !== null &&
                right !== null &&
                typeof left === "object" &&
                typeof right === "object" &&
                rfc9535Equals(left, right))
            );
          case ">":
            return (typeof left === "number" && typeof right === "number") ||
              (typeof left === "string" && typeof right === "string")
              ? left > right
              : false;
          case ">=":
            return (
              ((typeof left === "number" && typeof right === "number") ||
              (typeof left === "string" && typeof right === "string")
                ? left > right
                : false) ||
              left === right ||
              (left !== null &&
                right !== null &&
                typeof left === "object" &&
                typeof right === "object" &&
                rfc9535Equals(left, right))
            );
          default: {
            const val = this.evalAst(node, currentValue, rootValue);
            return val !== NOTHING && Boolean(val);
          }
        }
      }
      case "member": {
        if (node.object.type === "current") {
          if (currentValue === null || currentValue === undefined) {
            return false;
          }
          if (typeof currentValue === "object") {
            return Array.isArray(currentValue)
              ? node.property === "length"
              : hasOwn(currentValue, node.property);
          }
          return typeof currentValue === "string" && node.property === "length";
        }
        return this.evalAst(node, currentValue, rootValue) !== NOTHING;
      }
      case "index":
      case "current":
      case "root":
        return this.evalAst(node, currentValue, rootValue) !== NOTHING;
      case "literal":
        return Boolean(node.value);
      case "identifier":
        return false;
    }
  }

  static evalAst(node: ExprNode, currentValue: any, rootValue?: any): any {
    switch (node.type) {
      case "literal":
        return node.value;
      case "current":
        return currentValue === undefined ? NOTHING : currentValue;
      case "root":
        return rootValue === undefined ? NOTHING : rootValue;
      case "identifier":
        return NOTHING;
      case "member": {
        const obj =
          node.object.type === "current"
            ? currentValue
            : node.object.type === "root"
            ? rootValue
            : this.evalAst(node.object, currentValue, rootValue);
        if (obj === null || obj === undefined || obj === NOTHING) {
          return NOTHING;
        }
        if (typeof obj === "object") {
          if (Array.isArray(obj)) {
            return node.property === "length" ? obj.length : NOTHING;
          }
          return hasOwn(obj, node.property) ? obj[node.property] : NOTHING;
        }
        return typeof obj === "string" && node.property === "length"
          ? obj.length
          : NOTHING;
      }
      case "index": {
        const obj =
          node.object.type === "current"
            ? currentValue
            : node.object.type === "root"
            ? rootValue
            : this.evalAst(node.object, currentValue, rootValue);
        if (obj === null || obj === undefined || obj === NOTHING || typeof obj !== "object") {
          return NOTHING;
        }
        const key =
          node.index.type === "literal"
            ? node.index.value
            : this.evalAst(node.index, currentValue, rootValue);
        if (key === NOTHING) {
          return NOTHING;
        }
        if (Array.isArray(obj)) {
          if (typeof key !== "number" || !Number.isInteger(key)) {
            return NOTHING;
          }
          const idx = key < 0 ? obj.length + key : key;
          return idx >= 0 && idx < obj.length ? obj[idx] : NOTHING;
        }
        if (typeof key === "string") {
          return hasOwn(obj, key) ? obj[key] : NOTHING;
        }
        return NOTHING;
      }
      case "unary": {
        if (node.op === "!") {
          return !this.evalFilterAst(node.argument, currentValue, rootValue);
        }
        const val = this.evalAst(node.argument, currentValue, rootValue);
        if (val === NOTHING) {
          return NaN;
        }
        return node.op === "-" ? -Number(val) : +Number(val);
      }
      case "logical": {
        const left = this.evalAst(node.left, currentValue, rootValue);
        if (node.op === "&&") {
          return left !== NOTHING && left
            ? this.evalAst(node.right, currentValue, rootValue)
            : left;
        }
        return left !== NOTHING && left
          ? left
          : this.evalAst(node.right, currentValue, rootValue);
      }
      case "binary": {
        const left =
          node.left.type === "literal"
            ? node.left.value
            : this.evalAst(node.left, currentValue, rootValue);
        const right =
          node.right.type === "literal"
            ? node.right.value
            : this.evalAst(node.right, currentValue, rootValue);
        switch (node.op) {
          case "===":
          case "!==":
          case "==":
          case "!=":
          case ">":
          case ">=":
          case "<":
          case "<=":
            return this.evalComparison(node.op, left, right);
          case "+":
            return left === NOTHING || right === NOTHING ? NaN : left + right;
          case "-":
            return left === NOTHING || right === NOTHING ? NaN : left - right;
          case "*":
            return left === NOTHING || right === NOTHING ? NaN : left * right;
          case "/":
            return left === NOTHING || right === NOTHING ? NaN : left / right;
          case "%":
            return left === NOTHING || right === NOTHING ? NaN : left % right;
        }
      }
    }
  }

  static usesContext(node: ExprNode): boolean {
    switch (node.type) {
      case "current":
      case "root":
      case "identifier":
        return true;
      case "literal":
        return false;
      case "member":
        return this.usesContext(node.object);
      case "index":
        return this.usesContext(node.object) || this.usesContext(node.index);
      case "unary":
        return this.usesContext(node.argument);
      case "logical":
      case "binary":
        return this.usesContext(node.left) || this.usesContext(node.right);
    }
  }

  /**
   * Detects simple `@.length - k` (where k is a positive integer) so array
   * script selectors like `(@.length-1)` can run in O(k) memory.
   */
  static extractLengthOffset(node: ExprNode): number | null {
    if (
      node.type === "binary" &&
      node.op === "-" &&
      node.left.type === "member" &&
      node.left.object.type === "current" &&
      node.left.property === "length" &&
      node.right.type === "literal" &&
      typeof node.right.value === "number" &&
      Number.isInteger(node.right.value) &&
      node.right.value > 0
    ) {
      return node.right.value;
    }
    return null;
  }

  static evaluateFilter(
    expr: string,
    currentValue: any,
    rootValue?: any
  ): boolean {
    const ast = this.compile(expr);
    return this.evalFilterAst(ast, currentValue, rootValue);
  }

  static evaluateScript(
    expr: string,
    currentValue: any,
    rootValue?: any
  ): any {
    const ast = this.compile(expr);
    return this.evalAst(ast, currentValue, rootValue);
  }

  static staticEval(value: string): string {
    const trimmed = value.trim();
    if (trimmed === "true" || trimmed === "false" || trimmed === "null") {
      return trimmed;
    }
    if (/^-?[0-9]+(?:\.[0-9]+)?$/.test(trimmed)) {
      return String(Number(trimmed));
    }
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }
    // Simple arithmetic expression (numbers and +, -, *, /, %, parentheses)
    if (/^[0-9+\-*/%().\s]+$/.test(trimmed)) {
      try {
        const ast = this.compile(trimmed);
        if (!this.usesContext(ast)) {
          const result = this.evalAst(ast, undefined);
          if (result !== undefined && typeof result !== "function") {
            return String(result);
          }
        }
      } catch {
        return value;
      }
    }
    return value;
  }
}
