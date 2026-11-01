import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { adapterExtensions, adapterFor, measured, measuredExtensions } from "../src/core/languages/index.js";
import type { FileAnalysis, SourceFile } from "../src/core/types.js";

const here = dirname(fileURLToPath(import.meta.url));

async function measure(name: string): Promise<FileAnalysis> {
  const text = await readFile(join(here, "fixtures", "languages", name), "utf8");
  const source: SourceFile = { file: `tests/fixtures/languages/${name}`, hash: createHash("sha256").update(text).digest("hex"), text };
  const adapter = adapterFor(source.file);
  if (!adapter) throw new Error(`no adapter for ${name}`);
  return adapter.analyze(source);
}

const analyzeText = (file: string, text: string): FileAnalysis => {
  const adapter = adapterFor(file);
  if (!adapter) throw new Error(`no adapter for ${file}`);
  return adapter.analyze({ file, hash: createHash("sha256").update(text).digest("hex"), text });
};

const callable = (analysis: FileAnalysis, id: string) => {
  const found = analysis.callables.find(entry => entry.id === id);
  if (!found) throw new Error(`missing callable ${id}: ${analysis.callables.map(entry => entry.id).join(", ")}`);
  return found;
};

describe("language adapters", () => {
  it("owns exactly the measured extensions and nothing else", () => {
    expect(adapterExtensions()).toEqual(["go", "php", "py", "rs"]);
    expect(adapterFor("src/main.go")?.id).toBe("go");
    expect(adapterFor("src/job.py")?.id).toBe("python");
    expect(adapterFor("src/lib.rs")?.id).toBe("rust");
    expect(adapterFor("src/app.php")?.id).toBe("php");
    expect(adapterFor("src/main.ts")).toBeUndefined();
    expect(adapterFor("README.md")).toBeUndefined();
    expect(measuredExtensions()).toEqual(expect.arrayContaining(["go", "php", "py", "rs", "ts"]));
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
    expect(callable(analysis, "Classify")).toMatchObject({ decisions: 7, cc: 8, sloc: 20, line: 8, endLine: 27 });
    expect(callable(analysis, "Area")).toMatchObject({ decisions: 0, cc: 1, sloc: 3 });
    // A closure is its own callable, and its decisions never inflate the enclosing one.
    expect(callable(analysis, "func literal")).toMatchObject({ decisions: 0, cc: 1, sloc: 3 });
    expect(callable(analysis, "main")).toMatchObject({ decisions: 0, cc: 1 });
    expect(analysis.facts.symbols.find(symbol => symbol.name === "Area")?.kind).toBe("method");
    expect(analysis.facts.symbols.find(symbol => symbol.name === "Classify")?.kind).toBe("function");
    expect(analysis.facts.symbols[0]?.lang).toBe("Go");
  });

  it("measures Rust decisions, match arms and impl methods", async () => {
    const analysis = await measure("sample.rs");
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.sloc).toBe(35);
    expect(analysis.decisions).toBe(7);
    expect(analysis.facts.imports.map(site => site.spec)).toEqual(["engine", "std/collections"]);
    expect(analysis.callables.map(entry => entry.id)).toEqual(["area", "classify", "run", "closure"]);
    // Two non-wildcard match arms count; the wildcard arm decides nothing.
    expect(callable(analysis, "classify")).toMatchObject({ decisions: 4, cc: 5, sloc: 13 });
    expect(callable(analysis, "run")).toMatchObject({ decisions: 3, cc: 4, sloc: 11 });
    expect(analysis.facts.symbols.find(symbol => symbol.name === "area")?.kind).toBe("method");
    expect(analysis.facts.symbols.find(symbol => symbol.name === "run")?.kind).toBe("function");
    expect(analysis.facts.symbols[0]?.lang).toBe("Rust");
  });

  it("measures Python indentation blocks, a ternary and a rethrow", async () => {
    const analysis = await measure("sample.py");
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.sloc).toBe(24);
    expect(analysis.decisions).toBe(7);
    expect(analysis.facts.imports.map(site => site.spec)).toEqual(["os", ".engine"]);
    expect(analysis.callables.map(entry => entry.id)).toEqual(["__init__", "area", "classify", "load"]);
    expect(callable(analysis, "classify")).toMatchObject({ decisions: 6, cc: 7 });
    expect(callable(analysis, "load")).toMatchObject({ decisions: 1, cc: 2 });
    expect(analysis.facts.symbols.find(symbol => symbol.name === "__init__")?.kind).toBe("method");
    expect(analysis.patterns.map(pattern => pattern.rule)).toEqual(["catch-rethrow"]);
    expect(analysis.patterns[0]?.line).toBe(31);
  });

  it("measures PHP branches, an arrow function and a rethrow", async () => {
    const analysis = await measure("sample.php");
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.sloc).toBe(35);
    expect(analysis.decisions).toBe(7);
    expect(analysis.facts.imports.map(site => site.spec)).toEqual(["App/Engine/Runner", "App/Support/Clock", "/boot.php"]);
    expect(analysis.callables.map(entry => entry.id)).toEqual(["area", "classify", "load", "arrow function"]);
    expect(callable(analysis, "classify")).toMatchObject({ decisions: 6, cc: 7, line: 16, endLine: 30 });
    expect(callable(analysis, "load")).toMatchObject({ decisions: 1, cc: 2 });
    expect(analysis.patterns.map(pattern => pattern.rule)).toEqual(["catch-rethrow"]);
    expect(analysis.patterns[0]?.line).toBe(37);
  });

  it("discloses what a scanner cannot place instead of guessing", () => {
    expect(analyzeText("app/view.php", "<?php\n$x = 1;\n?>\n<p>markup</p>\n").diagnostics)
      .toEqual(["line 3: inline markup after ?> is not modeled"]);
    expect(analyzeText("app/broken.py", "def f():\n    return 'oops\n").diagnostics).toEqual(["line 2: unterminated string"]);
  });

  it("counts a PHP nullable type as no decision", () => {
    const analysis = analyzeText("app/types.php", "<?php\nfunction f(?int $n): ?int {\n    return $n;\n}\n");
    expect(analysis.decisions).toBe(0);
    expect(callable(analysis, "f")).toMatchObject({ decisions: 0, cc: 1 });
  });

  it("hashes a callable body deterministically", async () => {
    for (const name of ["sample.go", "sample.rs", "sample.py", "sample.php"]) {
      const first = await measure(name), second = await measure(name);
      expect(first.callables.map(entry => entry.cloneHash)).toEqual(second.callables.map(entry => entry.cloneHash));
      expect(first.callables.every(entry => /^[0-9a-f]{64}$/.test(entry.cloneHash))).toBe(true);
    }
  });
});
