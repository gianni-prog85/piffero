export class ConditionEval {
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
      } else if (val.startsWith('"') || val.startsWith("'") || val.startsWith("`")) {
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
    // Simple arithmetic expression (numbers and +, -, *, /, parentheses)
    if (/^[0-9+\-*/().\s]+$/.test(trimmed)) {
      try {
        const result = Function(`"use strict"; return (${trimmed});`)();
        if (result !== undefined && typeof result !== "function") {
          return String(result);
        }
      } catch {
        return value;
      }
    }
    return value;
  }
}
