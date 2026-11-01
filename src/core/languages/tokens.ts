import { digest } from "../util.js";
import type { Callable, FileAnalysis, Pattern, SourceFile } from "../types.js";

/** Token kinds stay coarse: clone hashing needs identity, not a grammar. */
type TokenKind = "id" | "num" | "str" | "punct";
export interface Token { text: string; kind: TokenKind; start: number; end: number; line: number; col: number }

interface QuoteRule { open: string; close: string; escapes: boolean; multiline: boolean }
export interface ScanSpec {
  /** Line-comment openers, matched in order. */
  line: readonly string[];
  /** Block-comment delimiters, optionally nested. */
  block?: { open: string; close: string; nested?: boolean };
  /** String delimiters, longest first after sorting. */
  quotes: readonly QuoteRule[];
  /** Python-style triple-quoted strings built from `quotes`. */
  triple?: boolean;
  /** Rust raw strings: r"…", r#"…"#, br##"…"##. */
  raw?: boolean;
  /** A single quote opens a character literal only when it closes within one character. */
  charLiteral?: boolean;
  /** PHP heredoc and nowdoc openers (<<<ID, <<<'ID'). */
  heredoc?: boolean;
  /** PHP leaves source mode here; the rest of the file is markup the scanner cannot place. */
  leavesSource?: string;
  /** Multi-character operators, longest first. */
  operators: readonly string[];
  ident: RegExp;
  number: RegExp;
}
export interface ScanResult { tokens: Token[]; diagnostics: string[]; sourceLines: number[] }

const IDENT = /[\p{L}_][\p{L}\p{N}_]*/uy;
const NUMBER = /(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/y;

/** Identifier and number spellings are shared by every supported language. */
export const COMMON = { ident: IDENT, number: NUMBER } as const;

const indexLines = (text: string): number[] => {
  const out: number[] = [];
  for (let k = 0; k < text.length; k++) if (text.charCodeAt(k) === 10) out.push(k);
  return out;
};
const lineAt = (newlines: readonly number[], position: number): number => {
  let lo = 0, hi = newlines.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (newlines[mid]! < position) lo = mid + 1; else hi = mid; }
  return lo + 1;
};

/**
 * One linear pass over the source (pi-trackers#99). Every branch advances the cursor, so the scan
 * is O(n) on untrusted text: no backtracking regex and no rescanned region.
 */
export function scan(spec: ScanSpec, text: string): ScanResult {
  const tokens: Token[] = [], diagnostics: string[] = [], sourceLines = new Set<number>();
  const newlines = indexLines(text);
  const opens = [...spec.quotes].sort((a, b) => b.open.length - a.open.length);
  const lineOf = (position: number): number => lineAt(newlines, position);
  const emit = (kind: TokenKind, start: number, end: number): void => {
    const startLine = lineOf(start), endLine = lineOf(Math.max(start, end - 1));
    tokens.push({ text: text.slice(start, end), kind, start, end, line: startLine, col: start - (newlines[startLine - 2] ?? -1) - 1 });
    for (let line = startLine; line <= endLine; line++) sourceLines.add(line);
  };
  let i = 0;
  while (i < text.length) {
    const char = text[i]!;
    if (char === "\n" || char === " " || char === "\t" || char === "\r") { i++; continue; }
    if (spec.leavesSource && text.startsWith(spec.leavesSource, i)) {
      diagnostics.push(`line ${lineOf(i)}: inline markup after ${spec.leavesSource} is not modeled`);
      break;
    }
    const lineComment = spec.line.find(marker => text.startsWith(marker, i));
    if (lineComment) { const end = text.indexOf("\n", i); i = end < 0 ? text.length : end; continue; }
    if (spec.block && text.startsWith(spec.block.open, i)) {
      let depth = 0, k = i;
      while (k < text.length) {
        if (spec.block.nested && text.startsWith(spec.block.open, k)) { depth++; k += spec.block.open.length; continue; }
        if (text.startsWith(spec.block.close, k)) { depth--; k += spec.block.close.length; if (depth <= 0) break; continue; }
        k++;
      }
      if (depth > 0) diagnostics.push(`line ${lineOf(i)}: unterminated block comment`);
      i = Math.min(k, text.length); continue;
    }
    const start = i;
    if (spec.raw) {
      const raw = /(?:b?r)(#*)"/y; raw.lastIndex = i;
      const match = raw.exec(text);
      if (match) {
        const close = '"' + match[1]!;
        const end = text.indexOf(close, raw.lastIndex);
        if (end < 0) { diagnostics.push(`line ${lineOf(i)}: unterminated raw string`); i = text.length; }
        else i = end + close.length;
        emit("str", start, i); continue;
      }
    }
    if (spec.heredoc && text.startsWith("<<<", i)) {
      const marker = /<<<[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\r?\n/y; marker.lastIndex = i;
      const match = marker.exec(text);
      if (!match) { diagnostics.push(`line ${lineOf(i)}: heredoc opener could not be read`); break; }
      const terminator = new RegExp("^[ \\t]*" + match[2] + "\\b", "m");
      const rest = text.slice(marker.lastIndex);
      const found = terminator.exec(rest);
      i = found ? marker.lastIndex + found.index + found[0].length : text.length;
      emit("str", start, i); continue;
    }
    const quote = opens.find(rule => text.startsWith(rule.open, i));
    // Rust lifetimes ('a, 'static) reuse the quote character; only a closed rune is a literal.
    if (quote && spec.charLiteral && quote.open === "'" && !/'(?:\\.|[^\\'\n])'/y.test(text.slice(i, i + 8))) {
      i += 1; emit("punct", start, i); continue;
    }
    if (quote) {
      const triple = !!spec.triple && text.startsWith(quote.open.repeat(3), i);
      const open = triple ? quote.open.repeat(3) : quote.open, close = triple ? quote.close.repeat(3) : quote.close;
      let k = i + open.length, closed = false;
      while (k < text.length) {
        if (quote.escapes && text[k] === "\\") { k += 2; continue; }
        if (text.startsWith(close, k)) { k += close.length; closed = true; break; }
        if (!quote.multiline && !triple && text[k] === "\n") break;
        k++;
      }
      if (!closed) diagnostics.push(`line ${lineOf(i)}: unterminated string`);
      i = k; emit("str", start, k); continue;
    }
    const operator = spec.operators.find(op => text.startsWith(op, i));
    if (operator) { i += operator.length; emit("punct", start, i); continue; }
    spec.ident.lastIndex = i;
    const ident = spec.ident.exec(text);
    if (ident) { i += ident[0].length; emit("id", start, i); continue; }
    spec.number.lastIndex = i;
    const number = spec.number.exec(text);
    if (number) { i += number[0].length; emit("num", start, i); continue; }
    i += 1; emit("punct", start, i);
  }
  return { tokens, diagnostics, sourceLines: [...sourceLines].sort((a, b) => a - b) };
}

/** Index of the token closing the bracket opened at `open`, or -1 when unbalanced. */
export function closeIndex(tokens: readonly Token[], open: number): number {
  const opener = tokens[open]?.text;
  const closer = opener === "{" ? "}" : opener === "(" ? ")" : opener === "[" ? "]" : undefined;
  if (!closer) return -1;
  let depth = 0;
  for (let k = open; k < tokens.length; k++) {
    if (tokens[k]!.text === opener) depth++;
    else if (tokens[k]!.text === closer && --depth === 0) return k;
  }
  return -1;
}

/** Clone identity: the same convention as the TypeScript path. */
const tokenDigest = (tokens: readonly Token[]): string => digest(JSON.stringify(tokens.map(token => `${token.kind}:${token.text}`)));

export interface Draft { name: string; kind: "function" | "method"; signature: number; bodyOpen: number; bodyClose: number }

/** A token that opens a decision point, decided by the language module. */
export type DecisionRule = (tokens: readonly Token[], index: number) => boolean;

/** File-level decisions: every decision token counts once, as on the compiler path. */
export const fileDecisions = (tokens: readonly Token[], isDecision: DecisionRule): number => {
  let count = 0;
  for (let k = 0; k < tokens.length; k++) if (isDecision(tokens, k)) count++;
  return count;
};

/** Own decisions for one callable: nested callable bodies belong to the nested callable. */
export const ownDecisions = (tokens: readonly Token[], isDecision: DecisionRule) =>
  (draft: Draft, nested: readonly Draft[]): number => {
    // Both ends belong to the body: a brace language opens with "{" and Python opens with a token.
    let count = 0;
    for (let k = draft.bodyOpen; k <= draft.bodyClose; k++) {
      if (nested.some(other => k >= other.signature && k <= other.bodyClose)) continue;
      if (isDecision(tokens, k)) count++;
    }
    return count;
  };

/** Import facts from a literal site: the substrate resolves the spec, this only records it. */
export const importSite = (file: string, line: number, spec: string): FileAnalysis["facts"]["imports"][number] => ({ file, line, spec });

export interface AssembleInput {
  file: SourceFile;
  lang: string;
  text: string;
  tokens: readonly Token[];
  drafts: readonly Draft[];
  patterns: Pattern[];
  diagnostics: string[];
  sourceLines: number[];
  decisions: number;
  /** Decisions inside [from, to] that belong to this draft, nested callables excluded. */
  ownDecisions: (draft: Draft, nested: readonly Draft[]) => number;
}

/** Shared callable assembly: SLOC, own decisions, CC, mass, clone identity, symbol facts. */
export function assemble(input: AssembleInput): FileAnalysis {
  const { tokens, drafts } = input;
  const counts = new Map<string, number>();
  const callables: Callable[] = [];
  const symbols: FileAnalysis["facts"]["symbols"] = [];
  for (const draft of drafts) {
    const ordinal = counts.get(draft.name) ?? 0; counts.set(draft.name, ordinal + 1);
    const id = ordinal ? `${draft.name}#${ordinal + 1}` : draft.name;
    const nested = drafts.filter(other => other !== draft && other.signature > draft.bodyOpen && other.bodyClose < draft.bodyClose);
    const body = tokens.slice(draft.bodyOpen, draft.bodyClose + 1);
    const owned = new Set<number>();
    for (const token of tokens.slice(draft.signature, draft.bodyClose + 1)) owned.add(token.line);
    const own = input.ownDecisions(draft, nested);
    const sloc = owned.size, cc = own + 1;
    const signature = input.text.slice(tokens[draft.signature]!.start, tokens[draft.bodyOpen]!.start).replace(/\s+/g, " ").slice(0, 180);
    callables.push({
      id, name: draft.name, line: tokens[draft.signature]!.line, endLine: tokens[draft.bodyClose]!.line,
      sloc, decisions: own, cc, mass: cc * Math.sqrt(sloc), cloneHash: tokenDigest(body),
      cloneLines: [...new Set(body.map(token => token.line))].sort((a, b) => a - b), tokenCount: body.length,
    });
    symbols.push({ file: input.file.file, name: id, kind: draft.kind, line: tokens[draft.signature]!.line, sig: signature, lang: input.lang });
  }
  return {
    facts: { sha1: input.file.hash, symbols, imports: [], calls: [], literals: [], anchors: [] },
    callables, sloc: input.sourceLines.length, decisions: input.decisions, sourceLines: input.sourceLines,
    patterns: input.patterns, diagnostics: input.diagnostics,
  };
}
