# ADR-FIREFOX-PORT: Firefox (AMO) port — adapters change, cores don't

- Status: proposed
- Date: 2026-05-29
- Deciders: Architect agent (Firefox-support team)
- Supersedes/extends: ADR-0001 (hexagonal), ADR-0002 (build/test), ADR-0005 (offscreen), ADR-0006 (blob handoff)
- Spec: `spec/SPEC-FIREFOX-SUPPORT.md` (FF1–FF7)

## Context and Problem Statement

The extension is a Chrome MV3 build. Chrome's background is a DOM-less **service worker**, which
forced two Chrome-specific mechanisms: (1) an **offscreen document** to run DOM rendering
(Readability + jsPDF/jszip), and (2) a **declarativeNetRequest** `modifyHeaders` rule to strip the
`Origin` header on the upload `fetch` (`viewer.supernote.com` returns 403 if `Origin` is present —
verified spike, `docs/SPIKE-F5-FR1.md`).

Firefox MV3 backgrounds run as a **DOM-capable, non-persistent event page** and do **not** implement
`chrome.offscreen`. We must ship one source tree producing two loadable, AMO-/CWS-compliant builds,
hold the 97% coverage gate and the 500-line file limit, and keep the Chrome build behaviorally
identical.

## Decision Drivers

- REUSE-first / DDD: no domain or use-case change; the hexagonal seam (`src/shared/ports.ts`) already
  isolates `chrome.*` to adapters (verified: `src/domain/*` and `src/conversion/*` contain no runtime
  `chrome.*`, only doc comments).
- DRY/I-F7: render and reader-parse logic must have exactly one implementation, shared by the Chrome
  offscreen dispatcher and the new Firefox in-page adapters.
- No Chrome regression (I-F6): every change additive or `__TARGET__`-gated.
- 97% coverage: the offscreen/render path is `c8 ignore`d today; the Firefox adapters re-expose that
  logic and must be testable — the shared core must be **messaging-free and DOM-only** so happy-dom +
  sinon-chrome can unit-test it.

## Decisions

### D1 — Direct render in the event page; no offscreen on Firefox (FF2)
Firefox runs the render/parse cores in-page via two thin adapters: `DirectRenderer` (implements
`Renderer`) and `DirectReaderParser` (implements a new narrow `ReaderParser` interface). No
`chrome.offscreen` / `getContexts` call exists on this target (I-F2). `ScriptingExtractor` stays the
`Extractor` on **both** targets; only its parser collaborator swaps (I-F4) — the
`scripting.executeScript` page-capture step is API-compatible and kept verbatim.

### D2 — Extract `render-parse-core.ts` BEFORE writing adapters (FF2-FR7, DRY, do first)
The bodies of `offscreen.ts` (`titleFromHtml`, `renderBytes`/`handleRender`'s render decision,
`handleExtractReader` incl. the Readability-miss `<body>` fallback at `offscreen.ts:66-72`) move
into one messaging-free module exporting `renderToBytes(html, options)` and `parseReader(html, url)`.
`offscreen.ts`, `direct-renderer.ts`, `direct-reader-parser.ts` all **delegate** to it; none holds a
copy (FF2-AC5 / I-F7). IndexedDB `put` stays in the **adapter** (not the core) so the core has no
storage dependency and is purely DOM+function (testable, reusable).

### D3 — Origin-strip: ship DNR config for Firefox AND build the webRequest stripper, gate by target (FF3)
We cannot run a live Firefox spike (FF3-FR1) in this environment. **Default decision:** keep the
existing `dnr-rules.json` + DNR permissions in the Firefox manifest (DNR is the least-privilege,
least-AMO-scrutiny path — D-F2) **and** implement `origin-stripper.firefox.ts` (blocking
`webRequest.onBeforeSendHeaders`, case-insensitive `Origin` removal, scoped to viewer/cloud only) so
the fallback is code-complete and unit-tested but **not wired** until the live spike says otherwise.
The composition root selects which one runs via a single constant. **Assumption to validate (R-F1):**
DNR header rules apply to the extension-initiated upload fetch on Firefox with the existing
`host_permissions`. If the spike fails, flip the constant + swap manifest permission keys (`webRequest`
+ `webRequestBlocking` in, DNR keys out) — no other code change. S3 `PUT` to `*.amazonaws.com` is
never touched by either mechanism (I-F3).

### D4 — Two background **contexts** via the bundler, not just a `__TARGET__` define (FF6-FR1)
**Key build finding (verified in plugin source `@samrum/vite-plugin-web-extension@5.1.1`):** the MV3
manifest parser's `getParseInputMethods()` returns **only** `parseInputBackgroundServiceWorker`
(`dist/index.mjs:878`). The `parseInputBackgroundScripts` method that converts `background.scripts` →
an event-page `background.page` HTML loader exists but is **wired only into the MV2 path** — so for an
MV3 manifest, setting `background.scripts` is **silently ignored** (no input registered, no chunk
emitted). Therefore the Firefox event-page background **cannot** be expressed as MV3
`background.scripts` through this plugin.

**Approach:** for Firefox, register the background entry as a plugin `additionalInputs.scripts` entry
(emits a built `.js` via `writeManifestScriptFile`), and set the Firefox manifest's
`background` to `{ scripts: ["<built-name>.js"], type: "module" }` **as static manifest data after the
plugin runs** (or via a tiny post-build manifest patch / `generateBundle` hook), since the plugin
won't process the MV3 `scripts` key itself. Chrome keeps `background.service_worker` (plugin-native,
unchanged). This isolates all build divergence to `vite.config.ts` + `manifest.config.ts`.

### D5 — Per-target `buildManifest(target)` + mode-driven Vite (FF5/FF6)
Separate parameterized manifests (not the MDN dual-key single manifest) because permission **sets**
diverge (Firefox drops `offscreen`, conditionally swaps DNR↔webRequest, adds `gecko.id` +
`strict_min_version`). Vite reads `mode` → picks the manifest, omits the `offscreen` HTML input for
Firefox (keeps `privacy`), and sets `define: { __TARGET__ }` for composition-root adapter selection.

### D6 — Local `browser-api.ts` shim, not `webextension-polyfill` (FF1, D-F4)
`export const api = (globalThis.browser ?? globalThis.chrome)`. One line of meaningful logic; zero
new runtime supply-chain surface. `webextension-polyfill` (promise-wrapping) is unnecessary because
the codebase already uses the promise-returning `chrome.*` surface and routes all async through ports.

### D7 — `render-parse-core.ts` lives in `src/conversion/` (per spec File Impact)
Although it uses DOM (`DOMParser`, `document`), it belongs to the conversion bounded context and the
spec's File Impact table places it there. It stays runtime-`chrome`-free (I-F1), so the
domain-platform-purity invariant (FF1-AC3) is unaffected — `conversion` may use DOM, just not `chrome.*`.

## Consequences

- Good: Chrome path changes are limited to `offscreen.ts` becoming a decode→delegate→encode shell and
  `service-worker.ts` losing its wiring to `composition.ts` — both behavior-preserving, covered by the
  FF7 regression gate.
- Good: the previously `c8 ignore`d render/parse logic becomes unit-testable in `render-parse-core.ts`,
  *raising* coverage rather than threatening it.
- Cost/Risk (R-F1): DNR-on-extension-fetch for Firefox is an unvalidated assumption; mitigated by the
  ready, tested webRequest fallback behind a one-line gate.
- Cost/Risk (R-F3): the plugin's MV3 background limitation (D4) means the Firefox background wiring is
  the single trickiest build task; budgeted as its own commit (FF6).
- Edge (R-F2): event-page eviction mid-render is covered by the existing IndexedDB job-resume model
  (F9-FR5); add `alarms` keep-alive only if a live render exceeds the event-page lifetime.

## More Information

`spec/SPEC-FIREFOX-SUPPORT.md` (FF1–FF7, Invariants I-F1…I-F7), `docs/SPIKE-F5-FR1.md` (the 403-on-Origin
finding), ADR-0001/0005/0006.
