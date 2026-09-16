import { PHONOSCOPE_LIMITS } from "./constants";
import type { PhonoscopeCompiledExpression, PhonoscopeInstruction, Token } from "./types";

const ALLOWED_VARIABLE_ROOTS = new Set([
  "time",
  "delta",
  "screen",
  "uv",
  "position",
  "velocity",
  "age",
  "lifetime",
  "track",
  "beat",
  "bar",
  "audio",
  "spectrum",
  "lyrics",
  "field",
  "effect",
  "palette",
  "settings",
  "random",
  "pi",
  "e",
]);

const FUNCTIONS: Record<string, { min: number; max: number }> = {
  sin: { min: 1, max: 1 },
  cos: { min: 1, max: 1 },
  tan: { min: 1, max: 1 },
  abs: { min: 1, max: 1 },
  sqrt: { min: 1, max: 1 },
  floor: { min: 1, max: 1 },
  ceil: { min: 1, max: 1 },
  fract: { min: 1, max: 1 },
  exp: { min: 1, max: 1 },
  log: { min: 1, max: 1 },
  min: { min: 2, max: 4 },
  max: { min: 2, max: 4 },
  pow: { min: 2, max: 2 },
  clamp: { min: 3, max: 3 },
  mix: { min: 3, max: 3 },
  step: { min: 2, max: 2 },
  smoothstep: { min: 3, max: 3 },
  noise: { min: 1, max: 4 },
  select: { min: 3, max: 3 },
  vec2: { min: 2, max: 2 },
  vec3: { min: 3, max: 3 },
  vec4: { min: 4, max: 4 },
};

const PRECEDENCE: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
  "^": 7,
};

const BINARY_OPCODE: Record<string, PhonoscopeInstruction["op"]> = {
  "+": "add",
  "-": "sub",
  "*": "mul",
  "/": "div",
  "%": "mod",
  "^": "pow",
  "<": "lt",
  "<=": "lte",
  ">": "gt",
  ">=": "gte",
  "==": "eq",
  "!=": "neq",
  "&&": "and",
  "||": "or",
};

function tokenizeExpression(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(rest);
    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest);
    if (identifier) {
      tokens.push({ kind: "identifier", value: identifier[0] });
      index += identifier[0].length;
      continue;
    }
    const pair = rest.slice(0, 2);
    if (["<=", ">=", "==", "!=", "&&", "||"].includes(pair)) {
      tokens.push({ kind: "operator", value: pair });
      index += 2;
      continue;
    }
    const char = rest[0];
    if ("+-*/%^<>!".includes(char)) {
      tokens.push({ kind: "operator", value: char });
      index += 1;
      continue;
    }
    if (char === "(") tokens.push({ kind: "left" });
    else if (char === ")") tokens.push({ kind: "right" });
    else if (char === ",") tokens.push({ kind: "comma" });
    else throw new Error(`Unexpected character '${char}' at column ${index + 1}`);
    index += 1;
  }
  tokens.push({ kind: "eof" });
  return tokens;
}

class ExpressionParser {
  private readonly tokens: Token[];
  private index = 0;
  readonly code: PhonoscopeInstruction[] = [];

  constructor(source: string) {
    this.tokens = tokenizeExpression(source);
  }

  parse() {
    this.expression(0);
    if (this.peek().kind !== "eof") throw new Error("Unexpected token after expression");
    if (this.code.length > PHONOSCOPE_LIMITS.expressionOperations) {
      throw new Error(`Expression exceeds ${PHONOSCOPE_LIMITS.expressionOperations} operations`);
    }
    return this.code;
  }

  private peek() {
    return this.tokens[this.index];
  }

  private take() {
    return this.tokens[this.index++];
  }

  private expression(minPrecedence: number) {
    this.prefix();
    while (true) {
      const token = this.peek();
      if (token.kind !== "operator" || token.value === "!") return;
      const precedence = PRECEDENCE[token.value];
      if (precedence === undefined || precedence < minPrecedence) return;
      const operator = token.value;
      this.take();
      this.expression(precedence + (operator === "^" ? 0 : 1));
      this.code.push({ op: BINARY_OPCODE[operator] as never });
    }
  }

  private prefix() {
    const token = this.take();
    if (token.kind === "number") {
      if (!Number.isFinite(token.value)) throw new Error("Numeric constants must be finite");
      this.code.push({ op: "const", value: token.value });
      return;
    }
    if (token.kind === "operator" && (token.value === "-" || token.value === "!")) {
      this.prefix();
      this.code.push({ op: token.value === "-" ? "neg" : "not" });
      return;
    }
    if (token.kind === "left") {
      this.expression(0);
      if (this.take().kind !== "right") throw new Error("Expected ')'");
      return;
    }
    if (token.kind !== "identifier") throw new Error("Expected a number, variable, function, or '('");

    if (this.peek().kind === "left") {
      this.take();
      const signature = FUNCTIONS[token.value];
      if (!signature) throw new Error(`Unknown function '${token.value}'`);
      let argc = 0;
      if (this.peek().kind !== "right") {
        while (true) {
          this.expression(0);
          argc += 1;
          if (this.peek().kind !== "comma") break;
          this.take();
        }
      }
      if (this.take().kind !== "right") throw new Error(`Expected ')' after ${token.value}`);
      if (argc < signature.min || argc > signature.max) {
        throw new Error(`${token.value} expects ${signature.min === signature.max ? signature.min : `${signature.min}-${signature.max}`} arguments`);
      }
      this.code.push({ op: "call", fn: token.value, argc });
      return;
    }

    const root = token.value.split(".")[0];
    if (!ALLOWED_VARIABLE_ROOTS.has(root)) throw new Error(`Unknown input '${token.value}'`);
    if (token.value === "pi") this.code.push({ op: "const", value: Math.PI });
    else if (token.value === "e") this.code.push({ op: "const", value: Math.E });
    else this.code.push({ op: "load", key: token.value });
  }
}

export function compilePhonoscopeExpression(value: string): PhonoscopeCompiledExpression {
  const source = value.startsWith("=") ? value.slice(1).trim() : value.trim();
  if (!source) throw new Error("Expression is empty");
  return { $expr: source, code: new ExpressionParser(source).parse() };
}
