import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { adapterExtensions, adapterFor, measured, measuredExtensions } from "../src/core/languages/index.js";
import type { FileAnalysis, SourceFile } from "../src/core/types.js";

const here = dirname(fileURLToPath(import.meta.url));

async function fixture(name: string): Promise<SourceFile> {
  const text = await readFile(join(here, "fixtures", "languages", name), "utf8");
  return { file: `tests/fixtures/languages/${name}`, hash: createHash("sha256").update(text).digest("hex"), text };
}

async function measure(name: string): Promise<FileAnalysis> {
  const source = await fixture(name);
  const adapter = adapterFor(source.file);
  if (!adapter) throw new Error(`no adapter for ${name}`);
  return adapter.analyze(source);
}

const callable = (analysis: FileAnalysis, id: string) => {
  const found = analysis.callables.find(entry => entry.id === id);
  if (!found) throw new Error(`missing callable ${id}: ${analysis.callables.map(entry => entry.id).join(", ")}`);
  return found;
};

describe("language adapters", () => {
  it("owns exactly the measured extensions and nothing else", () => {
    expect(adapterExtensions()).toEqual(["go"]);
    expect(adapterFor("src/main.go")?.id).toBe("go");
    expect(adapterFor("src/main.ts")).toBeUndefined();
    expect(adapterFor("README.md")).toBeUndefined();
    expect(measuredExtensions()).toContain("go");
    expect(measured("a.go")).toBe(true);
    expect(measured("a.ts")).toBe(true);
    expect(measured("a.rb")).toBe(false);
  });

  it("measures Go decisions, per-callable CC and imports", async () => {
    const analysis = await measure("sample.go");
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.sloc).toBe(34);
    expect(analysis.decisions).toBe(7);
    expect(analysis.facts.imports.map(site => site.spec)).toEqual(["fmt", "os"]);
    expect(analysis.callables.map(entry => entry.id)).toEqual(["Classify", "Area", "main", "func literal"]);
    const classify = callable(analysis, "Classify");
    expect({ decisions: classify.decisions, cc: classify.cc, sloc: classify.sloc }).toEqual({ decisions: 7, cc: 8, sloc: 20 });
    expect(classify.line).toBe(8);
    expect(classify.endLine).toBe(27);
    expect(callable(analysis, "Area")).toMatchObject({ decisions: 0, cc: 1, sloc: 3 });
    // A closure is its own callable, and its decisions never inflate the enclosing one.
    expect(callable(analysis, "func literal")).toMatchObject({ decisions: 0, cc: 1, sloc: 3 });
    expect(callable(analysis, "main")).toMatchObject({ decisions: 0, cc: 1 });
  });

  it("keeps a Go method distinct from a plain function", async () => {
    const analysis = await measure("sample.go");
    const symbols = analysis.facts.symbols.filter(symbol => symbol.file === analysis.facts.symbols[0]!.file);
    expect(symbols.find(symbol => symbol.name === "Area")?.kind).toBe("method");
    expect(symbols.find(symbol => symbol.name === "Classify")?.kind).toBe("function");
    expect(symbols[0]?.lang).toBe("Go");
  });

  it("hashes a Go clone body deterministically", async () => {
    const first = await measure("sample.go");
    const second = await measure("sample.go");
    expect(first.callables.map(entry => entry.cloneHash)).toEqual(second.callables.map(entry => entry.cloneHash));
    expect(callable(first, "Area").cloneHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
