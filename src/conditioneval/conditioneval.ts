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

function unescapeStringLiteral(raw: string): string {
  const inner = raw.slice(1, -1);
  let out = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "\\" && i + 1 < inner.length) {
      const next = inner[++i];
      switch (next) {
        case "n":
          out += "\n";
          break;
        case "r":
          out += "\r";
          break;
        case "t":
          out += "\t";
          break;
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case "\\":
          out += "\\";
          break;
        case "'":
          out += "'";
          break;
        case '"':
          out += '"';
          break;
        case "`":
          out += "`";
          break;
        case "u":
          if (i + 4 < inner.length) {
            const hex = inner.slice(i + 1, i + 5);
            if (/^[0-9a-fA-F]{4}$/.test(hex)) {
              out += String.fromCharCode(parseInt(hex, 16));
              i += 4;
              break;
            }
          }
          out += "u";
          break;
        default:
          out += next;
      }
    } else {
      out += ch;
    }
  }
  return out;
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

  static evalAst(node: ExprNode, currentValue: any, rootValue?: any): any {
    switch (node.type) {
      case "literal":
        return node.value;
      case "current":
        return currentValue;
      case "root":
        return rootValue;
      case "identifier":
        return undefined;
      case "member": {
        const obj = this.evalAst(node.object, currentValue, rootValue);
        if (obj === null || obj === undefined) {
          return undefined;
        }
        if (
          (Array.isArray(obj) || typeof obj === "string") &&
          node.property === "length"
        ) {
          return obj.length;
        }
        if (
          typeof obj === "object" &&
          Object.prototype.hasOwnProperty.call(obj, node.property)
        ) {
          return obj[node.property];
        }
        return undefined;
      }
      case "index": {
        const obj = this.evalAst(node.object, currentValue, rootValue);
        if (obj === null || obj === undefined || typeof obj !== "object") {
          return undefined;
        }
        const key = this.evalAst(node.index, currentValue, rootValue);
        if (Array.isArray(obj)) {
          return typeof key === "number" ? obj[key] : undefined;
        }
        if (
          typeof key === "string" ||
          typeof key === "number"
        ) {
          const prop = String(key);
          return Object.prototype.hasOwnProperty.call(obj, prop)
            ? obj[prop]
            : undefined;
        }
        return undefined;
      }
      case "unary": {
        const val = this.evalAst(node.argument, currentValue, rootValue);
        switch (node.op) {
          case "!":
            return !val;
          case "-":
            return -Number(val);
          case "+":
            return +Number(val);
        }
      }
      case "logical": {
        const left = this.evalAst(node.left, currentValue, rootValue);
        if (node.op === "&&") {
          return left ? this.evalAst(node.right, currentValue, rootValue) : left;
        }
        return left ? left : this.evalAst(node.right, currentValue, rootValue);
      }
      case "binary": {
        const left = this.evalAst(node.left, currentValue, rootValue);
        const right = this.evalAst(node.right, currentValue, rootValue);
        switch (node.op) {
          case "===":
            return left === right;
          case "!==":
            return left !== right;
          case "==":
            // eslint-disable-next-line eqeqeq
            return left == right;
          case "!=":
            // eslint-disable-next-line eqeqeq
            return left != right;
          case ">":
            return left > right;
          case ">=":
            return left >= right;
          case "<":
            return left < right;
          case "<=":
            return left <= right;
          case "+":
            return left + right;
          case "-":
            return left - right;
          case "*":
            return left * right;
          case "/":
            return left / right;
          case "%":
            return left % right;
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
    return Boolean(this.evalAst(ast, currentValue, rootValue));
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
