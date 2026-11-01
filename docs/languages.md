# Measured languages

Contour measures five languages. TypeScript and JavaScript go through the TypeScript compiler.
Go, Rust, Python and PHP go through a lexical adapter that reads tokens, not a grammar.

| Language | Extensions | Adapter |
|---|---|---|
| TypeScript / JavaScript | ts tsx mts cts js jsx mjs cjs | TypeScript compiler, `src/core/metrics.ts` |
| Go | go | `src/core/languages/go.ts` |
| Rust | rs | pending |
| Python | py | pending |
| PHP | php | pending |

## What an adapter measures

- **SLOC**: lines holding at least one token, so blank lines and comments never count.
- **Decisions**: the tokens named in the table below, counted once per file and again per callable.
- **CC**: own decisions + 1. A nested callable owns its own decisions.
- **Mass**: CC x sqrt(SLOC).
- **Clones**: a digest of the callable body tokens, so identical bodies group.
- **Imports**: literal module specs only, handed to the Fovea substrate for resolution.

## Decisions per language

| Language | Counted as a decision |
|---|---|
| Go | `if`, `for`, a non-default `case`, `&&`, `||` |
| Rust | pending |
| Python | pending |
| PHP | pending |

## Honest degradation

An adapter reports a diagnostic for anything it cannot place. The model then drops that file's
metrics and lists the diagnostic as a coverage gap. A gap is always visible; a guess is never
silent. Current triggers: inline markup after a PHP `?>`, an unterminated string or comment, and a
computed import target.

## Known limit

Rust `use` and PHP `use` specs may stay unresolved. The Fovea substrate resolves import families
for TypeScript, Python, Rust and Go, and has none for PHP (iniznet/pi-trackers#100).
