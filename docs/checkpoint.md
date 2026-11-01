# Commit checkpoint

An advisory checkpoint runs the review before a commit. Install it explicitly; nothing is overwritten, and an operational failure never blocks the commit.

```sh
contour hook install
contour hook uninstall
```

Explicit installation only. Existing hooks and symlinks are never overwritten; Git's hooks path is honored. The hook invokes the built CLI via an absolute path, so keep that package location available. Uninstall removes only an unmodified, checksum-verified Contour-managed hook.

Already using a hook manager? Add `contour review --staged --checkpoint` yourself. Advisory checkpoints print actionable findings or incomplete-coverage warnings, suppress repeated advisories for the same comparison, and stay quiet otherwise. Operational failures are printed but **do not block advisory commits**. Explicit reviews are never suppressed.

## Invariants

- Advisory by default: no finding, gap or operational failure blocks a commit.
- Repeat suppression keys on the comparison, so an unchanged patch stays quiet.
- Explicit reviews are never suppressed.
- With `--policy`, a boundary violation and a policy failure both propagate their exit code.

## Failure modes

A missing Git, an unreadable snapshot or a hook-path conflict prints and lets the commit through. Uninstall refuses an unmodified-check failure instead of deleting a hook someone else edited.

See [boundaries.md](boundaries.md) for the policy file the hook can carry.
