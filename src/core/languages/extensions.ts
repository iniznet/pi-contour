/**
 * Extensions handled by the compiler-backed path (pi-trackers#99).
 *
 * The measured set is this list plus every registered adapter, so the snapshot gate can never
 * disagree with the registry that actually owns the parsing.
 */
export const TYPESCRIPT_EXTENSIONS = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"] as const;
