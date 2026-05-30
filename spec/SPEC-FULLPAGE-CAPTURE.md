# Send to Supernote — Full Page ("as-is") Capture

## Metadata

- **Status:** Proposed (design for approval — no implementation yet)
- **Owner:** J-Raghavan
- **Version:** 0.1
- **Last Updated:** 2026-05-29
- **Branch:** `feat/firefox-support`
- **ADR:** `docs/adr/ADR-FULLPAGE-CAPTURE.md`
- **Base spec:** `spec/SPEC-SEND-TO-SUPERNOTE.md` (F1–F10) and `spec/SPEC-FIREFOX-SUPPORT.md` (the cross-browser adapters). The capture→convert→upload→jobs pipeline, the ports, and the FF4 `__TARGET__` render split are reused; only the *capture* and *render* of this one new mode are added.
- **Prior art:** [GoFullPage](https://chromewebstore.google.com/detail/gofullpage-full-page-scre/fdpohaocaechififmbbbbbknoalclacl) (scroll + stitch viewport tiles).

## Summary

Add a **Full Page** capture mode that delivers the page **as it actually looks** — the visual layout, not the Reader reflow — to Supernote. Because no WebExtension API returns a full page in one call (`tabs.captureVisibleTab` / `captureTab` return only the **visible viewport** — verified on MDN), Full Page works the way GoFullPage does: a content script **scrolls the page in viewport-height steps**, the background **captures each viewport** via `captureVisibleTab` (throttled), and a target-gated **stitch core** composites the tiles and **paginates them into a PDF** (via the bundled jsPDF), Supernote-friendly.

This is **true pixel fidelity** (the browser's own rendering), works on **both Chrome and Firefox**, and needs **no new alarming permission** (`activeTab`, granted by the send click). It deliberately rejects the two alternatives: `html2canvas` (the removed F4 — re-renders the DOM, so it can't reproduce fonts/transforms/`<canvas>`/cross-origin images faithfully — the very fidelity gap the user is unhappy with) and `chrome.debugger` print-to-PDF (highest fidelity but a scary permission + Chrome-only — a documented Non-Goal).

This spec defines eight features (FP1–FP8) with Functional Requirements (FR), Acceptance Criteria (AC), and Definition of Done (DoD). The **upload, delivery, jobs, and notification** layers are unchanged; the only pipeline change is a new `mode === 'fullpage'` **capture+stitch branch in the send-job saga** (`send-document.ts`), parallel to the existing `captureReader → renderDocument` branch.

---

## Goals

- **"As-is" fidelity.** Capture the rendered page (layout, images, fonts) as the browser draws it — the explicit user request ("see what the page looks like as-is").
- **Cross-browser.** Works on the Chrome (offscreen) and Firefox (event-page) builds with one source, reusing the FF4 target gating.
- **Least privilege.** No new broad host permission; `activeTab` (already granted on the send gesture) authorizes `captureVisibleTab` for the active tab. No `debugger`.
- **Reuse, don't fork.** The md5→upload→delivery→jobs→notify pipeline is untouched; Full Page produces a blob the saga uploads exactly like Reader's. Reuse jsPDF, `IndexedDbBlobTransfer`, and `derive-filename`. (The saga's capture/convert step does gain a Full Page branch — see Summary.)
- **Bounded and honest.** Cap very tall pages, document the fidelity caveats (stitch seams, fixed-element handling) in the UI.

## Non-Goals

- **Pixel-perfect beyond the browser's own screenshot.** Stitch boundaries and `position: fixed/sticky` handling are best-effort (see Edge Cases). We do not pursue `chrome.debugger` single-shot capture (Non-Goal — permission + Chrome-only).
- **Reviving html2canvas.** Full Page does **not** use html2canvas; it uses the browser's `captureVisibleTab`. (html2canvas is a direct dependency that this feature does not use; it may still be pulled transitively — dropping the direct dep is a separate cleanup.)
- **Horizontal/inner-scroll capture.** Capture is at the layout viewport width (content wider than the viewport is clipped, like GoFullPage); pages that scroll an inner container rather than the document are best-effort (FP6).
- **Changing the upload/delivery/jobs layers.** Out of scope by construction.
- **Editable/searchable output.** The PDF embeds rasterized page images (it is a screenshot), so its text is not selectable — by design (it's "as-is"). Reader mode remains the text-first option.

---

## Definitions

| Term | Definition |
|---|---|
| **Full Page mode** | A capture mode (`CaptureMode = 'fullpage'`) that screenshots the whole scrollable document as-is, vs **Reader** mode (Readability reflow). |
| **Tile** | One `captureVisibleTab` PNG of the current viewport at a given scroll offset. Stored via `IndexedDbBlobTransfer` and carried forward as a `{ handle, offsetY }` (not an inline data URL — FP3-FR4). |
| **Stitch** | Compositing the ordered tiles (resolved from their handles) onto a single tall canvas (accounting for `devicePixelRatio` and the final partial tile). |
| **Paginate** | Slicing the stitched tall image into page-height raster bands, each placed on a PDF page via `jsPDF.addImage` (NOT `jsPDF.html`). |
| **`captureVisibleTab`** | The WebExtension API that returns a data-URL screenshot of the **visible viewport only** (Chrome + Firefox). Rate-limited (~2/sec documented on Chrome; treat as bounded and unknown on Firefox — FP3-FR2). |
| **Keep-alive** | A mechanism (e.g. a long-lived `runtime.connect` Port from the injected orchestrator) that holds the background (SW/event page) alive across the multi-second capture so it doesn't idle-unload mid-run (FP3-FR5). |
| **Fixed/sticky neutralization** | Temporarily setting `position: static` on `fixed`/`sticky` elements during capture so a header/cookie-banner doesn't repeat on every tile; restored afterwards. |

---

## Architecture

Full Page reuses the existing seams; new pieces are the scroll-capture orchestration and a stitch/paginate core that slots into the **same FF4 target-gated render split** as the EPUB/PDF path.

```
Toolbar/context (mode = Full Page)
        │
        ▼
Service worker / event page  ── ensure token (unchanged)
        │
        ▼
saga (send-document.ts): mode === 'fullpage' branch (NEW; parallel to captureReader→renderDocument)
        │
        ▼
FullPageCapturer (new, background) — keeps the background ALIVE for the whole run:
   1. scripting.executeScript → inject the scroll-orchestrator content fn; resolve
      the active tab's windowId via api.tabs.get(tabId).windowId (NEW — there is no
      windowId in the codebase today; ChromeTabController only does create/close)
   2. background DRIVES the loop: for each offsetY it tells the content fn to
      scroll+settle, the content fn replies via runtime.sendMessage (NOT
      window.postMessage), then the background calls captureVisibleTab(windowId)
      (throttled), and STORES each tile via IndexedDbBlobTransfer → a handle
      (large PNG data URLs are NOT forwarded through runtime.sendMessage — F1-FR6)
   3. content fn: restore scroll + styles (finally)
        │  tileHandles: { handle, offsetY }[]  + geometry { dpr, viewport, totalHeight, width }
        ▼
stitchFullPage(tileHandles, geometry) — NEW TARGET-GATED stitch adapter (offscreen
   doc on Chrome, event page on Firefox; same __TARGET__ split as render-parse-core):
   resolve each handle via BlobTransfer → draw onto a canvas → jsPDF.addImage of
   page-height raster bands (NOT jsPDF.html — that's Reader's HTML path)
        │  bytes (application/pdf)  [optional: tall PNG]  → IndexedDbBlobTransfer.put → handle
        ▼
md5 + size → apply → PUT/POST → finish   (UNCHANGED — F5/F8)
        ▼
notify + badge (UNCHANGED — F6)
```

**Reuse + new:** `captureVisibleTab` is a background API on both targets; the **canvas stitching needs a DOM**, so it runs in the Chrome offscreen document or the Firefox event page — exactly the `__TARGET__` split FF4 established for `renderToBytes`/`parseReader`. The stitch adapter is **new** (it rasterizes image bands via `jsPDF.addImage`, distinct from Reader's `jsPDF.html()` path); its pure geometry/planner lives in `src/conversion/` next to `render-parse-core.ts`, `chrome`-free and happy-dom-testable. Tiles move by **blob handle**, never as data URLs over `runtime.sendMessage` (size/serialization limits — same handoff rule as F1-FR6).

---

## Workflow

```
0. probePdf runs FIRST (unchanged): if the tab is already a PDF, it pass-throughs the
   raw bytes and Full Page is NOT used (see Edge Cases) — Full Page is for HTML pages.
1. User picks Full Page (popup option, context menu, or settings.defaultMode='fullpage');
   the saga resolves the request to format=pdf for this mode (FP1-FR3) and takes the
   new fullpage branch.
2. activeTab granted by the click → background captureVisibleTab(activeTab.windowId)
3. Inject orchestrator; background drives the scroll loop (keeping itself alive):
      for offsetY in [0, vh, 2·vh, … , totalHeight-vh (clamped)]:
          content fn: scrollTo(0, offsetY); await rAF + lazyload settle; reply via
          runtime.sendMessage → background captureVisibleTab (≤2/sec) → store tile → handle
4. Content fn restores scroll + styles (finally, even on error/timeout)
5. stitchFullPage(tileHandles): resolve handles; canvas height = totalHeight·dpr (capped);
   draw each tile at offsetY·dpr; last tile clipped to avoid overlap
6. Paginate: slice the canvas into page-height raster bands → jsPDF.addImage per page (A4/Letter)
7. Blob → md5 → upload (unchanged) → notify
```

---

## Features

> Each feature: Functional Requirements (FR), Acceptance Criteria (AC, Given/When/Then), Definition of Done (DoD).

### FP1 — Full Page capture mode + UI
- **FP1-FR1.** Revive `CaptureMode = 'reader' | 'fullpage'` (domain) and `settings.defaultMode` (`'reader'` default — Reader stays the recommended default).
- **FP1-FR2.** The popup offers a Full Page option for a one-off send; a context-menu item *Send to Supernote (Full Page)* is added alongside Reader.
- **FP1-FR3.** Full Page forces `format: 'pdf'` (a screenshot has no reflowable text). Enforce this in `resolve-send-request`/the saga — **not only the UI** — so a stored `settings.defaultFormat='epub'` cannot leak EPUB into a Full Page send. Concretely in `resolveSendRequest`:
  ```ts
  const mode = overrides.mode ?? settings.defaultMode;
  const format = mode === 'fullpage' ? 'pdf' : (overrides.format ?? settings.defaultFormat);
  ```
- **FP1-FR4.** When Reader extraction is empty, suggest Full Page. Today `capture-reader.ts` returns `empty-article` with *"This page doesn't have readable content to send."* — extend that copy to *"…send — try Full Page instead."* now that the mode exists (a known stub the F4 removal left behind). Update the matching tests (`reader-dom.test.ts`).
- **FP1-AC1.** Given Full Page selected **on an HTML page**, when sent, the page is captured as-is and uploaded as a PDF. (On a PDF tab, `probePdf` pass-throughs the raw bytes and Full Page does not run — see Edge Cases.)
- **FP1-AC2.** Given `settings.defaultMode='fullpage'`, the toolbar send uses Full Page.
- **FP1-AC3.** Given a page Reader cannot extract, the error suggests trying Full Page.
- **DoD:** mode/UI wired; defaults persisted; Reader unaffected; empty-Reader copy updated; unit tests for mode resolution + the `'fullpage' → pdf` format enforcement.

### FP2 — Scroll orchestration content script (no persistent mutation)
- **FP2-FR1.** A self-contained `scripting.executeScript` function measures `document.documentElement.scrollHeight`, `clientHeight`/`innerHeight`, `devicePixelRatio`, and the scroll width, and computes the ordered scroll offsets.
- **FP2-FR2.** It neutralizes `position: fixed` and `position: sticky` elements (set `position: static`) before capture so headers/banners don't repeat on each tile, recording originals.
- **FP2-FR3.** At each step it scrolls, awaits a paint (`requestAnimationFrame`) and a short lazy-load settle, then signals readiness to the background via **`runtime.sendMessage`** (the injected function runs in the isolated content world where `chrome`/`browser.runtime.sendMessage` is available) — **not** `window.postMessage`. The background drives the loop and performs the capture per step.
- **FP2-FR4.** It **restores** the original scroll position and all mutated styles in a `finally` — even on error/timeout (capture must never leave the user's page altered — the I-4 principle).
- **FP2-AC1.** Given a multi-screen page, the computed offsets cover `[0 … totalHeight]` with no gap and a clamped final step.
- **FP2-AC2.** Given capture completes or throws, the page's scroll position and element styles are exactly as before (verified).
- **DoD:** the offset/geometry math is extracted to a pure, unit-tested helper (the executeScript fn is `c8 ignore`d like other injected fns); restoration verified.

### FP3 — Tile capture via captureVisibleTab (throttled, handle-based)
- **FP3-FR1.** The background captures each viewport with `api.tabs.captureVisibleTab(windowId, { format: 'png' })` (PNG), gated by `activeTab`. **The `windowId` must be resolved via `api.tabs.get(tabId).windowId`** — there is NO `windowId` in `src/` today, and `ChromeTabController` only does `create`/`close`, so this is new wiring (likely a small `TabController.windowIdOf(tabId)` addition or a dedicated capture port — see File Impact).
- **FP3-FR2.** Captures are **throttled**: on Chrome the documented quota is **≤ ~2 captures/sec** (`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` — a Chrome runtime constant, NOT in this codebase and not guaranteed on Firefox), so use a fixed inter-capture delay of ~500 ms on Chrome and a conservative fixed delay on Firefox (tune after measuring). On a quota error, back off and retry (FP3-FR3).
- **FP3-FR3.** A capture failure on a tile retries once (after a backoff); persistent failure fails the job with an actionable message (no partial silent upload).
- **FP3-FR4. (Handle-based handoff — F1-FR6 rule)** Each captured tile is **stored via `IndexedDbBlobTransfer`** and only its `{ handle, offsetY }` (plus the run geometry) is carried forward. Full-viewport PNG **data URLs are NOT forwarded through `runtime.sendMessage`** to the stitch step — many tiles would exceed practical message size and risk OOM; the stitch resolves handles back to bytes (same pattern as the offscreen render handoff).
- **FP3-FR5. (Keep the background alive)** A multi-tile capture spans seconds (throttle × scroll steps); the Chrome service worker / Firefox event page can unload mid-run. Hold the background alive for the duration — e.g. a `runtime.connect` long-lived Port from the injected orchestrator, or a chunked/resumable design — and tear it down when tiles are collected or on timeout (FP6-FR2).
- **FP3-AC1.** Given an N-viewport page, exactly N tiles are captured in order, each persisted to a handle, without quota errors.
- **FP3-AC2.** Given the background would otherwise idle-unload mid-capture, the keep-alive holds it until all tiles are collected (or the timeout fires).
- **DoD:** throttle + ordering + handle handoff covered by unit tests against faked capture/blob ports; keep-alive verified (manual on both targets given the eviction timing).

### FP4 — Target-gated stitch adapter (NEW — not the Reader render path)
- **FP4-FR1.** `src/conversion/fullpage-stitch-core.ts` (new) exposes pure geometry (`planFullPage(geometry)` → canvas size, per-tile draw rects, page slices) — unit-tested, `chrome`-free.
- **FP4-FR2.** A DOM stitch step resolves each tile **handle** (FP3-FR4) back to bytes, composites them onto a canvas (`devicePixelRatio`-aware; last tile clipped to avoid overlap), and produces the page-band images. It runs **target-gated** (offscreen document on Chrome, event page on Firefox) reusing the FF4 `__TARGET__` split. This is a **new adapter**, distinct from `renderToBytes`/Reader's `jsPDF.html()` — it rasterizes images, it does not lay out HTML.
- **FP4-FR3.** Respect the canvas max dimension: if `totalHeight·dpr` exceeds the cap, stitch in bands so no single canvas exceeds the limit.
- **FP4-FR4. (Recommended structure — mirror FF4)** Split like the render path to avoid duplicating FF4 patterns: a pure `fullpage-stitch-core.ts` (`planFullPage` + band math, happy-dom-tested) and a DOM `stitchFullPageToPdf()` that is `chrome`-free (like `render-parse-core.ts`), called by **thin target-gated adapters** in `src/background/` (an offscreen dispatch on Chrome vs a `DirectStitcher` on Firefox — exactly mirroring `OffscreenRenderer`/`DirectRenderer`). Not required for correctness, but keeps the `__TARGET__` split consistent.
- **FP4-AC1.** Given ordered tile handles + geometry, the stitched output reproduces the page top-to-bottom with no duplicated/overlapping bands.
- **DoD:** `planFullPage` fully unit-tested (happy-dom for the canvas-bound part; the DOM stitch glue is `c8 ignore`d); overall coverage holds the project gate (**≥97%** per `vitest.config.ts`; the pure planner should reach 100%).

### FP5 — Paginate to PDF + naming
- **FP5-FR1.** Slice the stitched image into page-height bands and place each on a jsPDF page (A4/Letter from `pageSize`) via **`jsPDF.addImage`** (raster bands) — a NEW code path, **not** Reader's `jsPDF.html()` (which lays out HTML). Produces `application/pdf` bytes, stored via `IndexedDbBlobTransfer` so the saga uploads it like any blob.
- **FP5-FR2.** Filename derives from the page title via the existing `derive-filename` (sanitized/deduped) — unchanged.
- **FP5-FR3.** Optional secondary output: a single tall PNG (behind a setting; default PDF).
- **FP5-AC1.** Given a 3-viewport page, the PDF has the expected page count and the bands tile the full height in order.
- **DoD:** pagination math unit-tested; output opens in a standard PDF reader and on-device (or documented untested).

### FP6 — Bounds, timeouts, partial success
- **FP6-FR1.** A **max-pages/max-height cap** (configurable; sensible default) bounds runaway captures; when truncated, notify the user that the page was capped.
- **FP6-FR2.** A **capture timeout** bounds the whole operation; on timeout, fail cleanly (page restored) with an actionable message.
- **FP6-FR3.** Inner-scroll/SPA pages where `scrollTo` doesn't move the document are detected (no scroll progress between steps) and fall back to a single-viewport capture with a note, rather than looping.
- **FP6-FR4. (Lifetime)** The whole capture runs under the FP3-FR5 keep-alive so the background does not idle-unload mid-run; the FP6-FR2 timeout is the hard upper bound that also releases the keep-alive.
- **FP6-AC1.** Given an extremely tall page, capture stops at the cap and the user is told it was truncated.
- **FP6-AC2.** Given a non-scrolling page, exactly one tile is captured (no infinite loop).
- **DoD:** caps + timeout + non-scrolling detection unit-tested.

### FP7 — Cross-browser parity + tests
- **FP7-FR1.** Full Page works on both targets: Chrome stitches in the offscreen document, Firefox in the event page (no offscreen) — via the FF4 `__TARGET__` gating; the Firefox bundle gains no offscreen dependency.
- **FP7-FR2.** Integration tests (mocked capture + faked DOM) cover capture→stitch→paginate→upload for both targets; coverage stays ≥97%.
- **FP7-AC1.** Given the Firefox build, Full Page produces a PDF with no offscreen reference in the bundle.
- **DoD:** both builds exercise the path; bundle audit unaffected; `npm run check` green.

### FP8 — Fidelity disclosure
- **FP8-FR1.** The UI labels Full Page as "captures the page as-is (best-effort at fixed banners and very tall pages)" so expectations match the stitch tradeoffs.
- **FP8-FR2.** README/Options note the known artifacts (fixed-element handling, stitch seams, max height) and that Full Page PDFs are image-based (text not selectable).
- **DoD:** copy present in UI + README.

---

## Invariants
- **IP-1.** Capture never persistently mutates the user's page — scroll position and all styles are restored even on error (FP2-FR4).
- **IP-2.** No new broad permission — Full Page uses `activeTab` only (no `debugger`, no `<all_urls>`).
- **IP-3.** The **upload/delivery/jobs/notification** layers are unchanged — Full Page yields a blob the saga uploads exactly like Reader's. The saga's capture/convert step is the one place that changes (a new `mode === 'fullpage'` branch).
- **IP-4.** Cross-browser parity — the only target difference is where the canvas stitch runs (offscreen vs event page), via the existing FF4 gate; the Firefox bundle stays offscreen-free.
- **IP-5.** Output is an image-based PDF (a screenshot) — honest "as-is", not searchable text.

## Edge Cases
- **PDF tab + Full Page selected:** `probePdf` runs **before** mode resolution and sets `req.source` for a PDF tab (`service-worker.ts`), so the saga's source branch pass-throughs the raw PDF and **Full Page does not scroll-capture**. This is intended (the page already *is* a faithful PDF); FP1-AC1 is therefore scoped to HTML pages. Documented so "Full Page" isn't read as "always tiles."
- **Background unloads mid-capture:** a long capture (throttle × steps) can outlive the idle SW/event-page lifetime; held alive by FP3-FR5 and bounded by the FP6-FR2 timeout. This is the same **event-page-lifetime risk the Firefox port already flags for long renders** (the `alarms`/keep-alive note in SPEC-FIREFOX-SUPPORT.md, FF7 — that spec is local/un-tracked, so this bullet states the concern directly rather than relying on the cross-reference).
- **Fixed/sticky headers, cookie banners:** neutralized to `position: static` during capture (appear once at top), restored after — a deliberate tradeoff vs repeating on every tile.
- **Lazy-loaded images:** the scroll-through triggers them; a per-step settle waits before capture; very slow loads may still miss — bounded by the timeout.
- **Very tall pages:** capped (FP6-FR1) and band-stitched (FP4-FR3) to respect canvas limits; user warned on truncation.
- **Non-scrolling / inner-scroll pages (SPAs):** detected (no scroll progress) → single-viewport fallback (FP6-FR3), no infinite loop.
- **`devicePixelRatio` ≠ 1 (HiDPI):** tiles are larger than CSS pixels; geometry scales by dpr so bands align.
- **Horizontal overflow:** captured at viewport width (clipped) — matches GoFullPage.
- **captureVisibleTab quota exceeded:** throttled (FP3-FR2); on error, retry once then fail cleanly.
- **Cross-origin iframes / `<canvas>` / video:** captured faithfully (it's a screenshot, not a DOM re-render — the key advantage over html2canvas).
- **Protected pages (`chrome://`, PDF viewer, store):** not capturable — surface the same "can't capture this page" message as Reader.

## Security
- Inherits the base security model (D-2 token-only, D-3 zero-intermediary). Full Page adds no new network destination and no new credential surface.
- `captureVisibleTab` returns image bytes that go only to the user's chosen Supernote target (same pipeline) — never a third party.
- `activeTab` (granted by the user's send gesture) is the only capability needed; no `debugger`, no `<all_urls>`.

## Non-Functional Requirements
- **Performance:** capture of a typical multi-screen page completes in a few seconds — bounded by the per-second capture quota (≤ ~2/sec on Chrome) and the FP6-FR2 timeout; progress is reflected via the badge/notifications.
- **Background lifetime:** the capture must keep the background (SW/event page) alive for its full duration (FP3-FR5) — a multi-tile run exceeds the idle-unload window, so the design must not assume a persistent background.
- **Memory / messaging:** tiles are passed by **blob handle**, never as data URLs over `runtime.sendMessage` (FP3-FR4) — a tall page is many full-viewport PNGs; forwarding them inline would risk OOM / message-size limits.
- **Footprint:** no new runtime dependency — reuses jsPDF (bundled) + canvas + `IndexedDbBlobTransfer`. (html2canvas is not used by this feature.)
- **Reliability:** no partial silent uploads; page state always restored.

## Constraints
- MV3 on both targets; the canvas stitch needs a DOM → offscreen (Chrome) / event page (Firefox), via FF4 gating.
- `captureVisibleTab` is viewport-only and rate-limited (the core constraint that dictates scroll+stitch).
- Canvas max dimension (~16k–32k px) bounds single-canvas height → band stitching + page cap.
- Tech: TypeScript, the existing capture/conversion seams, jsPDF. No html2canvas, no `chrome.debugger`.

## File / Module Impact (anticipated)
| Path | Change |
|---|---|
| `src/domain/capture.ts` | Revive `CaptureMode = 'reader' \| 'fullpage'` + `settings.defaultMode` (FP1) |
| `src/jobs/send-document.ts` | NEW `mode === 'fullpage'` branch (capture+stitch) parallel to `captureReader → renderDocument` — the one saga change (Summary/IP-3) |
| `src/capture/capture-fullpage.ts` *(new)* | Background orchestrator: drive scroll loop via `runtime.sendMessage`, throttled `captureVisibleTab(windowId)`, store each tile via `IndexedDbBlobTransfer` (handles), keep-alive Port (FP2/FP3); pure offset helper extracted |
| `src/conversion/fullpage-stitch-core.ts` *(new)* | Pure `planFullPage(geometry)` (band math) + DOM `stitchFullPageToPdf()` (resolve handles → canvas → `jsPDF.addImage` raster bands — NOT `jsPDF.html`); `chrome`-free, like `render-parse-core.ts` (FP4-FR4/FP5). Thin target-gated adapters live in `src/background/` (offscreen vs `DirectStitcher`) |
| `src/shared/ports.ts` + `src/jobs/send-document.ts` | NEW port(s) on `SendDocumentDeps` (or a parallel deps bag) for the fullpage capture + stitch collaborators — mirrors how `render`/`capture` are injected today |
| `src/background/composition.ts` | Wire the fullpage capturer + the target-gated stitcher, mirroring `makeRenderer()` (OffscreenRenderer vs DirectRenderer) under the same `__TARGET__` gate (FF4 parity) — so Firefox uses the event-page stitcher and the bundle stays offscreen-free |
| `src/background/tab-controller.ts` (or a new capture port) | Add `windowIdOf(tabId)` (via `api.tabs.get`) + the `captureVisibleTab` wrapper — neither exists today (FP3-FR1) |
| `src/background/*` (offscreen dispatcher + Firefox direct path) | Route the stitch via the FF4 `__TARGET__` split (FP4-FR2/FP7) |
| `src/popup/*`, `src/options/*`, `src/background/context-menus.ts` | Full Page option + context-menu item + default mode (FP1) |
| `src/jobs/resolve-send-request.ts`, `triggers.ts` | Mode routing + force `format='pdf'` for fullpage (FP1-FR3) |
| `src/capture/capture-reader.ts` + `reader-dom.test.ts` | Extend the `empty-article` copy to suggest Full Page (FP1-FR4) |
| `vitest.config.ts` | Drop the stale `'src/content/fullpage.ts'` coverage exclude (that file was deleted with F4) — cleanup when implementing |
| `docs/ddd/architecture.md` | Update — it still describes the removed F4 / html2canvas Full Page paths |
| `README.md`, Options copy | Fidelity disclosure (FP8) |
| `tests/**` | Unit (geometry/plan/throttle/restore/handle-handoff/format-enforcement) + integration (capture→stitch→PDF, both targets) |

## Required Tests
- **Unit:** scroll-offset planner (full coverage incl. clamped last step + non-scrolling → 1 tile); `planFullPage` geometry (dpr scaling, band splitting at the canvas cap, last-tile clip); capture throttle/ordering/retry against a faked capture port; mode resolution (`fullpage` → pdf); restore-on-error.
- **Integration (mocked capture + faked DOM):** Full Page → PDF for Chrome (offscreen) and Firefox (event page); destinations only the chosen Supernote target (IP-3); Firefox bundle has no offscreen ref (IP-4/FP7-AC1).
- **Manual/on-device (release gate):** capture a long article and a layout-heavy page (recipe/dashboard) on Chrome and Firefox; confirm fidelity, fixed-element handling, page count, and on-device rendering; confirm page state restored.

## Risks & Open Questions
- **RP-1: stitch-boundary artifacts / fixed elements.** Inherent to scroll+stitch. *Mitigation:* fixed/sticky neutralization + clear UI labeling (FP8). **Open:** is neutralization (header once at top) acceptable, or should we offer a "keep fixed elements" toggle (accepting repetition)?
- **RP-2: very tall pages.** Canvas limits + huge files. *Mitigation:* band stitch + page cap + warning (FP4-FR3/FP6-FR1). **Open:** default cap value?
- **RP-3: capture quota latency.** Long pages take seconds. *Mitigation:* throttle + progress. Acceptable?
- **RP-4: inner-scroll SPAs.** `scrollTo` may not move the document. *Mitigation:* non-scroll detection → single-viewport fallback (FP6-FR3). **Open:** attempt to detect and scroll the dominant inner scroll container, or leave as single-viewport?
- **RP-5: image-based PDF (no selectable text).** By design for "as-is". Confirm this matches the user's expectation (Reader remains the text-first option).

## Sources
- [MDN — `tabs.captureVisibleTab` (viewport-only)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/captureVisibleTab)
- [MDN — `tabs.captureTab`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/captureTab)
- [GoFullPage — Full Page Screen Capture (prior art: scroll + stitch)](https://chromewebstore.google.com/detail/gofullpage-full-page-scre/fdpohaocaechififmbbbbbknoalclacl)
- `spec/SPEC-SEND-TO-SUPERNOTE.md` (F4 removed Full Page / D-1) · `spec/SPEC-FIREFOX-SUPPORT.md` (FF4 target gating) · `docs/adr/ADR-FULLPAGE-CAPTURE.md`
