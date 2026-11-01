import { COMMON, assemble, closeIndex, fileDecisions, importSite, ownDecisions, scan, type ScanSpec, type Token } from "./tokens.js";
import type { FileAnalysis, Pattern, SourceFile } from "../types.js";
import type { LanguageAdapter } from "./types.js";

const PYTHON: ScanSpec = {
  line: ["#"],
  quotes: [
    { open: '"', close: '"', escapes: true, multiline: false },
    { open: "'", close: "'", escapes: true, multiline: false },
  ],
  triple: true,
  operators: ["**=", "//=", ">>=", "<<=", "==", "!=", "<=", ">=", "->", ":=", "+=", "-=", "*=", "/=", "**", "//", "<<", ">>"],
  ...COMMON,
};

interface Line { line: number; indent: number; first: number; last: number }

/** Group tokens by physical line: indentation is the first token's column. */
const lineGroups = (tokens: readonly Token[]): Line[] => {
  const out: Line[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k]!;
    const previous = out.at(-1);
    if (previous && previous.line === token.line) { previous.last = k; continue; }
    out.push({ line: token.line, indent: token.col, first: k, last: k });
  }
  return out;
};

/** A mid-line "if" is a conditional expression or a comprehension filter; both branch. */
const isDecision = (tokens: readonly Token[], index: number): boolean => {
  const text = tokens[index]!.text;
  return text === "if" || text === "elif" || text === "for" || text === "while" || text === "except" || text === "and" || text === "or";
};

interface Draft { name: string; kind: "function" | "method"; signature: number; bodyOpen: number; bodyClose: number }

/** def and async def share one shape: name, params, then an indented block. */
const callables = (tokens: readonly Token[], lines: readonly Line[]): Draft[] => {
  const out: Draft[] = [];
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k]!.text !== "def") continue;
    const name = tokens[k + 1];
    if (name?.kind !== "id" || tokens[k + 2]?.text !== "(") continue;
    const params = closeIndex(tokens, k + 2);
    if (params < 0) continue;
    const defLine = lines.find(entry => k >= entry.first && k <= entry.last);
    if (!defLine) continue;
    const after = lines.slice(lines.indexOf(defLine) + 1);
    const bodyFirst = after.find(entry => entry.indent > defLine.indent);
    if (!bodyFirst) continue;
    const dedent = after.find(entry => entry.indent <= defLine.indent);
    const bodyClose = (dedent ? lines[lines.indexOf(dedent) - 1]! : lines.at(-1)!).last;
    out.push({ name: name.text, kind: defLine.indent === 0 ? "function" : "method", signature: k, bodyOpen: bodyFirst.first, bodyClose });
  }
  return out;
};

/** A dotted module path read from one line: ids and dots until the path ends. */
const dotted = (tokens: readonly Token[], from: number, line: number): string => {
  let spec = "";
  for (let k = from; k < tokens.length && tokens[k]!.line === line; k++) {
    const token = tokens[k]!;
    if (token.text === "import" || token.text === "as") break;
    if (token.kind === "id" || token.text === ".") { spec += token.text; continue; }
    break;
  }
  return spec;
};

/** import a.b | from .x import y. Each statement is read from its own line. */
const imports = (tokens: readonly Token[], lines: readonly Line[], file: string): FileAnalysis["facts"]["imports"] => {
  const out: FileAnalysis["facts"]["imports"] = [];
  for (const line of lines) {
    const first = tokens[line.first]!;
    if (first.text === "import") {
      const spec = dotted(tokens, line.first + 1, line.line);
      if (spec) out.push(importSite(file, first.line, spec));
      continue;
    }
    if (first.text === "from") {
      const spec = dotted(tokens, line.first + 1, line.line);
      if (spec) out.push(importSite(file, first.line, spec));
    }
  }
  return out;
};

/** except E as e: then a body whose only statement is "raise e". */
const patterns = (tokens: readonly Token[], lines: readonly Line[]): Pattern[] => {
  const out: Pattern[] = [];
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k]!.text !== "except") continue;
    const line = lines.find(entry => k >= entry.first && k <= entry.last);
    if (!line) continue;
    let asIndex = k + 1;
    while (asIndex < line.last && tokens[asIndex]!.text !== "as") asIndex++;
    if (tokens[asIndex]?.text !== "as") continue;
    const name = tokens[asIndex + 1];
    if (name?.kind !== "id") continue;
    const next = lines[lines.indexOf(line) + 1];
    if (!next || next.indent <= line.indent) continue;
    const body = tokens.slice(next.first, next.last + 1);
    if (body.length !== 2 || body[0]!.text !== "raise" || body[1]!.text !== name.text) continue;
    out.push({ rule: "catch-rethrow", line: next.line, endLine: next.line, question: "Does this except add behavior, or can the original exception propagate directly?" });
  }
  return out;
};

export const python: LanguageAdapter = {
  id: "python",
  lang: "Python",
  extensions: ["py"],
  analyze(input: SourceFile): FileAnalysis {
    const { tokens, diagnostics, sourceLines } = scan(PYTHON, input.text);
    const lines = lineGroups(tokens);
    const analysis = assemble({
      file: input, lang: "Python", text: input.text, tokens, drafts: callables(tokens, lines),
      patterns: patterns(tokens, lines), diagnostics, sourceLines,
      decisions: fileDecisions(tokens, isDecision),
      ownDecisions: ownDecisions(tokens, isDecision),
    });
    analysis.facts.imports = imports(tokens, lines, input.file);
    return analysis;
  },
};
