import { go } from "./go.js";
import { php } from "./php.js";
import { python } from "./python.js";
import { rust } from "./rust.js";
import { TYPESCRIPT_EXTENSIONS } from "./extensions.js";
import type { LanguageAdapter } from "./types.js";

/**
 * Registered lexical adapters (pi-trackers#99). Order is fixed, so a file's adapter never depends
 * on map iteration order, and an extension belongs to exactly one adapter.
 */
const ADAPTERS: readonly LanguageAdapter[] = [go, php, python, rust];

const BY_EXTENSION = new Map<string, LanguageAdapter>();
for (const adapter of ADAPTERS) for (const extension of adapter.extensions) BY_EXTENSION.set(extension, adapter);

/** Every extension an adapter owns, sorted. */
export const adapterExtensions = (): string[] => [...BY_EXTENSION.keys()].sort();

/** Every extension that carries measured syntax, sorted. */
export const measuredExtensions = (): string[] => [...TYPESCRIPT_EXTENSIONS, ...adapterExtensions()].sort();

/** True when this file's syntax is measured rather than disclosed as unsupported. */
export const measured = (file: string): boolean => {
  const match = /\.([A-Za-z0-9]+)$/.exec(file);
  if (!match) return false;
  const extension = match[1]!.toLowerCase();
  return (TYPESCRIPT_EXTENSIONS as readonly string[]).includes(extension) || BY_EXTENSION.has(extension);
};

/** The gate regexp form, so the snapshot keeps one definition of "measurable". */
export const MEASURED_PATTERN = new RegExp(`\\.(?:${measuredExtensions().join("|")})$`, "i");

/** The adapter for a repository-relative path, or undefined when the compiler path owns it. */
export const adapterFor = (file: string): LanguageAdapter | undefined => {
  const match = /\.([A-Za-z0-9]+)$/.exec(file);
  return match ? BY_EXTENSION.get(match[1]!.toLowerCase()) : undefined;
};

export type { LanguageAdapter } from "./types.js";
