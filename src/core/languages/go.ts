import { COMMON, assemble, closeIndex, fileDecisions, importSite, ownDecisions, scan, type ScanSpec, type Token } from "./tokens.js";
import type { FileAnalysis, SourceFile } from "../types.js";
import type { LanguageAdapter } from "./types.js";

const GO: ScanSpec = {
  line: ["//"],
  block: { open: "/*", close: "*/" },
  quotes: [
    { open: '"', close: '"', escapes: true, multiline: false },
    { open: "'", close: "'", escapes: true, multiline: false },
    { open: "`", close: "`", escapes: false, multiline: true },
  ],
  operators: [":=", "...", "==", "!=", "<=", ">=", "&&", "||", "<-", "++", "--", "+=", "-=", "*=", "/=", "<<", ">>", "&^"],
  ...COMMON,
};

/** Decision points: if, for, a non-default case clause, and the two short-circuit operators. */
const isDecision = (tokens: readonly Token[], index: number): boolean => {
  const text = tokens[index]!.text;
  if (text === "if" || text === "for" || text === "&&" || text === "||") return true;
  // switch and select both open branches with case; "default:" opens none.
  return text === "case" && tokens[index + 1]?.text !== ":";
};

const unquote = (text: string): string => text.replace(/^["'`]/, "").replace(/["'`]$/, "");

/** func Name(  |  func (r T) Name(  |  func( literal. */
const callables = (tokens: readonly Token[]): Array<{ name: string; kind: "function" | "method"; signature: number; bodyOpen: number; bodyClose: number }> => {
  const out: Array<{ name: string; kind: "function" | "method"; signature: number; bodyOpen: number; bodyClose: number }> = [];
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k]!.text !== "func") continue;
    let name = "func literal", cursor = k + 1;
    let kind: "function" | "method" = "function";
    if (tokens[cursor]?.text === "(") {
      const receiver = closeIndex(tokens, cursor);
      if (receiver < 0) continue;
      if (tokens[receiver + 1]?.kind === "id" && tokens[receiver + 2]?.text === "(") {
        name = tokens[receiver + 1]!.text; kind = "method"; cursor = receiver + 2;
      }
    }
    if (tokens[cursor]?.kind === "id" && (tokens[cursor + 1]?.text === "(" || tokens[cursor + 1]?.text === "[")) {
      name = tokens[cursor]!.text; cursor += 1;
    }
    // Go 1.18 type parameters: func Map[T any, U any](
    if (tokens[cursor]?.text === "[") {
      const generics = closeIndex(tokens, cursor);
      if (generics < 0) continue;
      cursor = generics + 1;
    }
    if (tokens[cursor]?.text !== "(") continue;
    const params = closeIndex(tokens, cursor);
    if (params < 0) continue;
    // Results follow the parameters. A top-level comma, semicolon, equals sign or another func
    // keyword means this is a function TYPE in a signature, not a declaration with a body.
    let body = params + 1, depth = 0, typeOnly = false;
    for (; body < tokens.length; body++) {
      const text = tokens[body]!.text;
      if (depth === 0 && text === "{") break;
      if (depth === 0 && (text === ";" || text === "=" || text === "func" || text === ",")) { typeOnly = true; break; }
      if (text === "(" || text === "[") depth++;
      else if (text === ")" || text === "]") depth--;
    }
    if (typeOnly || tokens[body]?.text !== "{") continue;
    const close = closeIndex(tokens, body);
    if (close < 0) continue;
    out.push({ name, kind, signature: k, bodyOpen: body, bodyClose: close });
  }
  return out;
};

/** import "x" | import alias "x" | import ( "a"; "b" ). */
const imports = (tokens: readonly Token[], file: string): FileAnalysis["facts"]["imports"] => {
  const out: FileAnalysis["facts"]["imports"] = [];
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k]!.text !== "import") continue;
    let cursor = k + 1;
    if (tokens[cursor]?.text === "(") {
      const close = closeIndex(tokens, cursor);
      if (close < 0) continue;
      for (let j = cursor + 1; j < close; j++) if (tokens[j]!.kind === "str") out.push(importSite(file, tokens[j]!.line, unquote(tokens[j]!.text)));
      continue;
    }
    if (tokens[cursor]?.kind === "id" && tokens[cursor + 1]?.kind === "str") cursor += 1;
    if (tokens[cursor]?.kind === "str") out.push(importSite(file, tokens[cursor]!.line, unquote(tokens[cursor]!.text)));
  }
  return out;
};

export const go: LanguageAdapter = {
  id: "go",
  lang: "Go",
  extensions: ["go"],
  analyze(input: SourceFile): FileAnalysis {
    const { tokens, diagnostics, sourceLines } = scan(GO, input.text);
    const analysis = assemble({
      file: input, lang: "Go", text: input.text, tokens, drafts: callables(tokens), patterns: [], diagnostics, sourceLines,
      decisions: fileDecisions(tokens, isDecision),
      ownDecisions: ownDecisions(tokens, isDecision),
    });
    analysis.facts.imports = imports(tokens, input.file);
    return analysis;
  },
};
