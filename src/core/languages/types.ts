import type { FileAnalysis, SourceFile } from "../types.js";

/**
 * One language's lexical adapter (pi-trackers#99).
 *
 * The adapter measures only what a token scan can prove. A construct it cannot place becomes a
 * diagnostic, and the model then drops that file's metrics and shows the gap. Silence is never a
 * measurement.
 */
export interface LanguageAdapter {
  /** Stable id, used in diagnostics and docs. */
  readonly id: string;
  /** Language name recorded on symbol facts, matching the substrate vocabulary. */
  readonly lang: string;
  /** Extensions this adapter owns, lowercase and without the dot. */
  readonly extensions: readonly string[];
  analyze(input: SourceFile): FileAnalysis;
}
