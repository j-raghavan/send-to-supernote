/**
 * Unified WebExtension namespace (FF1-FR1, ADR-FIREFOX-PORT D6).
 *
 * Firefox exposes `browser`; Chrome exposes `chrome`. Adapters import `api`,
 * never bare `chrome.*` at runtime, so the same source compiles for both. The
 * shim resolves to `chrome` when `browser` is absent (FF1-AC1/I-F6), so Chrome
 * behavior is byte-identical. Typed as `typeof chrome` so call sites are
 * type-identical and no type churn is needed.
 */
export const api: typeof chrome =
  (globalThis as { browser?: typeof chrome }).browser ?? globalThis.chrome;
