import { COMMON, assemble, closeIndex, fileDecisions, importSite, ownDecisions, scan, type ScanSpec, type Token } from "./tokens.js";
import type { FileAnalysis, SourceFile } from "../types.js";
import type { LanguageAdapter } from "./types.js";

const RUST: ScanSpec = {
  line: ["//"],
  block: { open: "/*", close: "*/", nested: true },
  quotes: [
    { open: '"', close: '"', escapes: true, multiline: true },
    { open: "'", close: "'", escapes: true, multiline: false },
  ],
  charLiteral: true,
  raw: true,
  operators: ["..=", "::", "->", "=>", "==", "!=", "<=", ">=", "&&", "||", "..", "+=", "-=", "*=", "/=", "<<", ">>"],
  ...COMMON,
};

/** Decision points: if, while, for, loop, short-circuit operators, and a non-wildcard match arm. */
const matchArms = (tokens: readonly Token[]): Set<number> => {
  const arms = new Set<number>();
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k]!.text !== "match") continue;
    let open = k + 1;
    while (open < tokens.length && tokens[open]!.text !== "{") open++;
    const close = closeIndex(tokens, open);
    if (close < 0) continue;
    for (let j = open + 1; j < close; j++) {
      if (tokens[j]!.text !== "=>") continue;
      // Walk back to the arm head; a wildcard arm matches anything and decides nothing.
      let head = j - 1;
      while (head > open && tokens[head - 1]!.text !== "," && tokens[head - 1]!.text !== "{" && tokens[head - 1]!.text !== "=>") head--;
      if (tokens[head]?.text !== "_") arms.add(j);
    }
  }
  return arms;
};

const isDecisionWith = (arms: ReadonlySet<number>) => (tokens: readonly Token[], index: number): boolean => {
  const text = tokens[index]!.text;
  if (text === "if" || text === "while" || text === "for" || text === "loop" || text === "&&" || text === "||") return true;
  return text === "=>" && arms.has(index);
};

/** Ranges of impl and trait blocks: a fn inside one is a method, not a free function. */
const implBlocks = (tokens: readonly Token[]): Array<{ open: number; close: number }> => {
  const out: Array<{ open: number; close: number }> = [];
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k]!.text !== "impl" && tokens[k]!.text !== "trait") continue;
    let open = k + 1;
    while (open < tokens.length && tokens[open]!.text !== "{") open++;
    const close = closeIndex(tokens, open);
    if (close > open) out.push({ open, close });
  }
  return out;
};

const kindAt = (blocks: ReadonlyArray<{ open: number; close: number }>, index: number): "function" | "method" =>
  blocks.some(block => index > block.open && index < block.close) ? "method" : "function";

/** fn name(  |  fn name<T>(  |  a block-bodied closure |name| { . */
const callables = (tokens: readonly Token[]): Array<{ name: string; kind: "function" | "method"; signature: number; bodyOpen: number; bodyClose: number }> => {
  const blocks = implBlocks(tokens);
  const out: Array<{ name: string; kind: "function" | "method"; signature: number; bodyOpen: number; bodyClose: number }> = [];
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k]!.text === "fn") {
      const name = tokens[k + 1];
      if (name?.kind !== "id") continue;
      let cursor = k + 2;
      // Generic parameters follow the name: fn load<T>(. Nested bounds need a depth count.
      if (tokens[cursor]?.text === "<") {
        let depth = 0;
        for (; cursor < tokens.length; cursor++) {
          if (tokens[cursor]!.text === "<") depth++;
          else if (tokens[cursor]!.text === ">" && --depth === 0) { cursor += 1; break; }
        }
      }
      if (tokens[cursor]?.text !== "(") continue;
      const params = closeIndex(tokens, cursor);
      if (params < 0) continue;
      let body = params + 1;
      while (body < tokens.length && tokens[body]!.text !== "{" && tokens[body]!.text !== ";") body++;
      if (tokens[body]?.text !== "{") continue;
      const close = closeIndex(tokens, body);
      if (close < 0) continue;
      out.push({ name: name.text, kind: kindAt(blocks, k), signature: k, bodyOpen: body, bodyClose: close });
      continue;
    }
    // A closure opens with | and closes with |; only a block body is measured.
    if (tokens[k]!.text === "|" && k > 0) {
      let close = k + 1;
      while (close < tokens.length && tokens[close]!.text !== "|") close++;
      const body = close + 1;
      if (tokens[body]?.text !== "{") continue;
      const end = closeIndex(tokens, body);
      if (end < 0) continue;
      out.push({ name: "closure", kind: kindAt(blocks, k), signature: k, bodyOpen: body, bodyClose: end });
    }
  }
  return out;
};

/** use crate::a::b; | use std::io::{Read, Write}; | mod engine; */
const imports = (tokens: readonly Token[], file: string): FileAnalysis["facts"]["imports"] => {
  const out: FileAnalysis["facts"]["imports"] = [];
  for (let k = 0; k < tokens.length; k++) {
    const keyword = tokens[k]!.text;
    if (keyword !== "use" && keyword !== "mod") continue;
    const segments: string[] = [];
    let cursor = k + 1;
    for (; cursor < tokens.length; cursor++) {
      const text = tokens[cursor]!.text;
      if (text === ";" || text === "{" || text === "}") break;
      if (tokens[cursor]!.kind === "id") segments.push(text);
    }
    const kept = segments.filter(segment => !["crate", "self", "super", "as"].includes(segment));
    // Rust modules are lowercase and items are types: a trailing uppercase segment names the item,
    // not the module, so the resolver gets the module path only.
    if (kept.length > 1 && /^[A-Z]/.test(kept.at(-1) ?? "")) kept.pop();
    const path = kept.join("/");
    if (path) out.push(importSite(file, tokens[k]!.line, keyword === "mod" ? `./${path}` : path));
  }
  return out;
};

export const rust: LanguageAdapter = {
  id: "rust",
  lang: "Rust",
  extensions: ["rs"],
  analyze(input: SourceFile): FileAnalysis {
    const { tokens, diagnostics, sourceLines } = scan(RUST, input.text);
    const isDecision = isDecisionWith(matchArms(tokens));
    const drafts = callables(tokens);
    const analysis = assemble({
      file: input, lang: "Rust", text: input.text, tokens, drafts, patterns: [], diagnostics, sourceLines,
      decisions: fileDecisions(tokens, isDecision),
      ownDecisions: ownDecisions(tokens, isDecision),
    });
    analysis.facts.imports = imports(tokens, input.file);
    return analysis;
  },
};

