/**
 * Build-time global constants (FF4-FR2).
 *
 * These are Vite `define` constants resolved to literals at build time (NOT
 * runtime values). Branching on them lets Rollup eliminate dead branches and
 * tree-shake per-target code (e.g. the offscreen adapters drop out of the
 * Firefox bundle — I-F2 / FF2-FR6). FF6 wires the defines into `vite.config.ts`
 * (mode-driven); until then they default to the Chrome values.
 *
 * - `__TARGET__` — the browser the bundle targets.
 * - `__USE_WEBREQUEST__` — Firefox-only flag selecting the blocking webRequest
 *   origin-strip fallback over the default DNR rule (defaults to false).
 */
declare const __TARGET__: 'chrome' | 'firefox';
declare const __USE_WEBREQUEST__: boolean;
