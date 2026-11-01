import { COMMON, assemble, closeIndex, fileDecisions, importSite, ownDecisions, scan, type ScanSpec, type Token } from "./tokens.js";
import type { FileAnalysis, Pattern, SourceFile } from "../types.js";
import type { LanguageAdapter } from "./types.js";

const PHP: ScanSpec = {
  // PHP 8 attributes open with #[; only a bare # starts a comment.
  line: ["//", { open: "#", skipWhen: "[" }],
  block: { open: "/*", close: "*/" },
  quotes: [
    { open: '"', close: '"', escapes: true, multiline: true },
    { open: "'", close: "'", escapes: true, multiline: true },
    { open: "`", close: "`", escapes: true, multiline: true },
  ],
  heredoc: true,
  leavesSource: "?>",
  operators: ["<=>", "===", "!==", "?:", "??=", "...", "->", "?->", "=>", "::", "==", "!=", "<=", ">=", "&&", "||", "??", "+=", "-=", "*=", "/=", ".=", "++", "--", "<<", ">>"],
  ...COMMON,
};

/**
 * A ternary "?" follows an expression and does not start a type. "??", "?->", and a nullable type
 * (?int) are excluded, so the count tracks branches rather than question marks.
 */
const ternary = (tokens: readonly Token[], index: number): boolean => {
  const previous = tokens[index - 1], next = tokens[index + 1];
  if (!previous || !next) return false;
  if (next.text === "->" || next.text === "?") return false;
  return previous.kind === "id" || previous.kind === "num" || previous.kind === "str"
    || [")", "]", "}"].includes(previous.text);
};

/** match arms carry => and a non-default head, exactly like the Rust arms. */
const matchArms = (tokens: readonly Token[]): ReadonlySet<number> => {
  const arms = new Set<number>();
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k]!.text !== "match") continue;
    let open = k + 1;
    while (open < tokens.length && tokens[open]!.text !== "{") open++;
    const close = closeIndex(tokens, open);
    if (close < 0) continue;
    for (let j = open + 1; j < close; j++) {
      if (tokens[j]!.text !== "=>") continue;
      let head = j - 1;
      while (head > open && tokens[head - 1]!.text !== "," && tokens[head - 1]!.text !== "{") head--;
      if (tokens[head]?.text !== "default") arms.add(j);
    }
  }
  return arms;
};

/**
 * A switch case is followed by ":" on its line. An enum case (PHP 8.1) sets "=" or ends with ";"
 * and opens nothing, so it stays out of the decision count.
 */
const branchCase = (tokens: readonly Token[], index: number): boolean => {
  const line = tokens[index]!.line;
  for (let j = index + 1; j < tokens.length && tokens[j]!.line === line; j++) {
    if (tokens[j]!.text === ":") return true;
    if (tokens[j]!.text === ";" || tokens[j]!.text === "=") return false;
  }
  return false;
};

const isDecisionWith = (arms: ReadonlySet<number>) => (tokens: readonly Token[], index: number): boolean => {
  const text = tokens[index]!.text;
  if (["if", "elseif", "for", "foreach", "while", "do", "catch", "and", "or", "&&", "||", "??"].includes(text)) return true;
  if (text === "case") return branchCase(tokens, index);
  if (text === "=>") return arms.has(index);
  return text === "?" && ternary(tokens, index);
};

const unquote = (text: string): string => text.replace(/^["'`]/, "").replace(/["'`]$/, "");

/** function name(  |  function (  |  fn ($x) => . */
const callables = (tokens: readonly Token[]): Array<{ name: string; kind: "function" | "method"; signature: number; bodyOpen: number; bodyClose: number }> => {
  const out: Array<{ name: string; kind: "function" | "method"; signature: number; bodyOpen: number; bodyClose: number }> = [];
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k]!.text !== "function" && tokens[k]!.text !== "fn") continue;
    const arrow = tokens[k]!.text === "fn";
    let cursor = k + 1;
    if (tokens[cursor]?.text === "&") cursor += 1;
    let name = arrow ? "arrow function" : "closure";
    if (tokens[cursor]?.kind === "id" && tokens[cursor + 1]?.text === "(") { name = tokens[cursor]!.text; cursor += 1; }
    if (tokens[cursor]?.text !== "(") continue;
    const params = closeIndex(tokens, cursor);
    if (params < 0) continue;
    if (arrow) {
      let body = params + 1;
      while (body < tokens.length && tokens[body]!.text !== "=>") body++;
      if (tokens[body]?.text !== "=>") continue;
      let close = body + 1;
      while (close + 1 < tokens.length && tokens[close + 1]!.text !== ";") close++;
      out.push({ name, kind: "function", signature: k, bodyOpen: body, bodyClose: Math.min(close, tokens.length - 1) });
      continue;
    }
    let body = params + 1;
    if (tokens[body]?.text === "use") body = closeIndex(tokens, body + 1) + 1;
    while (body < tokens.length && tokens[body]!.text !== "{" && tokens[body]!.text !== ";") body++;
    if (tokens[body]?.text !== "{") continue;
    const close = closeIndex(tokens, body);
    if (close < 0) continue;
    out.push({ name, kind: "function", signature: k, bodyOpen: body, bodyClose: close });
  }
  return out;
};

/** use A\\B; | require __DIR__ . '/x.php'; */
const imports = (tokens: readonly Token[], file: string): FileAnalysis["facts"]["imports"] => {
  const out: FileAnalysis["facts"]["imports"] = [];
  for (let k = 0; k < tokens.length; k++) {
    const text = tokens[k]!.text;
    if (text === "use") {
      const segments: string[] = [];
      let cursor = k + 1;
      for (; cursor < tokens.length; cursor++) {
        if (tokens[cursor]!.text === ";") break;
        if (tokens[cursor]!.kind === "id") segments.push(tokens[cursor]!.text);
      }
      const spec = segments.join("/");
      if (spec) out.push(importSite(file, tokens[k]!.line, spec));
    }
    if (text === "require" || text === "require_once" || text === "include" || text === "include_once") {
      let cursor = k + 1;
      while (cursor < tokens.length && tokens[cursor]!.text !== ";" && tokens[cursor]!.kind !== "str") cursor++;
      if (tokens[cursor]?.kind === "str") out.push(importSite(file, tokens[k]!.line, unquote(tokens[cursor]!.text)));
    }
  }
  return out;
};

/** catch (E $e) { throw $e; } | $x ? true : false */
const patterns = (tokens: readonly Token[]): Pattern[] => {
  const out: Pattern[] = [];
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k]!.text === "catch") {
      const params = tokens[k + 1]?.text === "(" ? closeIndex(tokens, k + 1) : -1;
      if (params < 0) continue;
      // The caught variable is written $name, which the scanner keeps as two tokens.
      const variable = tokens[params - 1], dollar = tokens[params - 2];
      const body = tokens[params + 1]?.text === "{" ? closeIndex(tokens, params + 1) : -1;
      if (!variable || variable.kind !== "id" || dollar?.text !== "$" || body < 0) continue;
      const inner = tokens.slice(params + 2, body).filter(token => token.text !== ";").map(token => token.text).join("");
      if (inner === "throw$" + variable.text)
        out.push({ rule: "catch-rethrow", line: tokens[k]!.line, endLine: tokens[body]!.line, question: "Does this catch add behavior, or can the original exception propagate directly?" });
    }
    if (tokens[k]!.text === "?" && ternary(tokens, k)) {
      const whenTrue = tokens[k + 1], whenFalse = tokens[k + 3];
      const literals = new Set(["true", "false"]);
      if (whenTrue && whenFalse && tokens[k + 2]?.text === ":" && literals.has(whenTrue.text) && literals.has(whenFalse.text) && whenTrue.text !== whenFalse.text)
        out.push({ rule: "boolean-conditional", line: tokens[k]!.line, endLine: tokens[k + 3]!.line, question: "Would an explicit Boolean conversion or negation express the same result more directly?" });
    }
  }
  return out;
};

export const php: LanguageAdapter = {
  id: "php",
  lang: "PHP",
  extensions: ["php"],
  analyze(input: SourceFile): FileAnalysis {
    // The opening tag is markup, not source; blank it so offsets and line numbers survive.
    const text = input.text.replace(/^(\s*)<\?(?:php|=)?/i, (whole, lead: string) => lead + " ".repeat(whole.length - lead.length));
    const { tokens, diagnostics, sourceLines } = scan(PHP, text);
    const isDecision = isDecisionWith(matchArms(tokens));
    const analysis = assemble({
      file: input, lang: "PHP", text, tokens, drafts: callables(tokens), patterns: patterns(tokens), diagnostics, sourceLines,
      decisions: fileDecisions(tokens, isDecision),
      ownDecisions: ownDecisions(tokens, isDecision),
    });
    analysis.facts.imports = imports(tokens, input.file);
    return analysis;
  },
};
