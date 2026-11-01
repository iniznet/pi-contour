# Boundary policies

A policy file names path prefixes that may not import each other. A new, directly resolved, unambiguous relative import that crosses one becomes a blocking finding.

No automatic project configuration loading. Opt in with a CLI path:

```json
{
  "boundaries": [
    { "from": "src/core", "to": "src/ui", "reason": "Core must not depend on presentation." }
  ]
}
```

```sh
contour review --policy contour-policy.json
contour hook install --policy contour-policy.json
```

Policies match repository-relative path prefixes on **new, directly resolved, unambiguous relative imports**. Existing violations do not become new regressions. No code, commands, regular expressions, or complexity thresholds are evaluated from policy files.

## Invariants

- Only a new import counts; a pre-existing violation never becomes a regression.
- Only a directly resolved relative import counts; a bare alias or dynamic target is not certified compliant.
- A reason string is required, because the finding quotes it as the review question.

Exit codes: **0** advisory · **2** explicit boundary violation · **1** operation/usage failure. Policy-enabled hooks propagate failures as well as violations. Display truncation/suppression never disables enforcement. Unsupported resolution is not certified compliant; inspect coverage.
