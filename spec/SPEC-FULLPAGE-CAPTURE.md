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

This spec defines eight features (FP1–FP8) with Functional Requirements (FR), Acceptance Criteria (AC), and Definition of Done (DoD). The downstream pipeline (auth, upload, jobs, notifications) is unchanged.

---

## Goals

- **"As-is" fidelity.** Capture the rendered page (layout, images, fonts) as the browser draws it — the explicit user request ("see what the page looks like as-is").
- **Cross-browser.** Works on the Chrome (offscreen) and Firefox (event-page) builds with one source, reusing the FF4 target gating.
- **Least privilege.** No new broad host permission; `activeTab` (already granted on the send gesture) authorizes `captureVisibleTab` for the active tab. No `debugger`.
- **Reuse, don't fork.** The convert→md5→upload→jobs→notify pipeline is untouched; Full Page just yields a blob like Reader. Reuse jsPDF and `derive-filename`.
- **Bounded and honest.** Cap very tall pages, document the fidelity caveats (stitch seams, fixed-element handling) in the UI.

## Non-Goals

- **Pixel-perfect beyond the browser's own screenshot.** Stitch boundaries and `position: fixed/sticky` handling are best-effort (see Edge Cases). We do not pursue `chrome.debugger` single-shot capture (Non-Goal — permission + Chrome-only).
- **Reviving html2canvas.** Full Page does **not** use html2canvas; it uses the browser's `captureVisibleTab`. (html2canvas remains a bundled dep used by nothing here; dropping it is a separate cleanup.)
- **Horizontal/inner-scroll capture.** Capture is at the layout viewport width (content wider than the viewport is clipped, like GoFullPage); pages that scroll an inner container rather than the document are best-effort (FP6).
- **Changing the upload/delivery/jobs layers.** Out of scope by construction.
- **Editable/searchable output.** The PDF embeds rasterized page images (it is a screenshot), so its text is not selectable — by design (it's "as-is"). Reader mode remains the text-first option.

---

## Definitions

| Term | Definition |
|---|---|
| **Full Page mode** | A capture mode (`CaptureMode = 'fullpage'`) that screenshots the whole scrollable document as-is, vs **Reader** mode (Readability reflow). |
| **Tile** | One `captureVisibleTab` PNG of the current viewport at a given scroll offset. |
| **Stitch** | Compositing the ordered tiles onto a single tall canvas (accounting for `devicePixelRatio` and the final partial tile). |
| **Paginate** | Slicing the stitched tall image into page-height chunks, each placed on a PDF page (jsPDF). |
| **`captureVisibleTab`** | The WebExtension API that returns a data-URL screenshot of the **visible viewport only** (Chrome + Firefox). Rate-limited per second. |
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
FullPageCapturer (new, background):
   1. scripting.executeScript → inject the scroll-orchestrator content fn
   2. content fn: measure (scrollHeight, clientHeight, dpr, scrollW),
      neutralize fixed/sticky, then for each step: scroll, await paint+lazyload,
      postMessage "ready@offsetY"; background calls captureVisibleTab (throttled)
   3. content fn: restore scroll + styles (finally)
        │  tiles: { dataUrl, offsetY }[]  + { dpr, viewport, totalHeight, width }
        ▼
stitchFullPage(tiles, geometry) — TARGET-GATED core (offscreen doc on Chrome,
   event page on Firefox; same split as render-parse-core / FF4):
   draw tiles onto a canvas → paginate into a jsPDF PDF (page-height slices)
        │  bytes (application/pdf)  [optional: tall PNG]
        ▼
IndexedDbBlobTransfer.put → RenderedBlob handle
        │
        ▼
md5 + size → apply → PUT/POST → finish   (UNCHANGED — F5/F8)
        ▼
notify + badge (UNCHANGED — F6)
```

**Reuse:** `captureVisibleTab` is a background API on both targets; the **canvas stitching needs a DOM**, so it runs in the Chrome offscreen document or the Firefox event page — exactly the `__TARGET__` split FF4 already established for `renderToBytes`/`parseReader`. The stitch core lives in `src/conversion/` next to `render-parse-core.ts`, `chrome`-free, happy-dom-testable for its pure geometry math.

---

## Workflow

```
1. User picks Full Page (popup option, context menu, or settings.defaultMode='fullpage')
2. activeTab granted by the click → background may captureVisibleTab the active tab
3. Inject orchestrator → measure → neutralize fixed/sticky → scroll loop:
      for offsetY in [0, vh, 2·vh, … , totalHeight-vh (clamped)]:
          window.scrollTo(0, offsetY); await rAF + lazyload settle
          → background captureVisibleTab (throttled to quota) → tile
4. Restore scroll + styles (finally, even on error/timeout)
5. stitchFullPage(tiles): canvas height = totalHeight·dpr (capped); draw each tile at
   offsetY·dpr; the last tile is clipped to avoid overlap
6. Paginate: slice the canvas into page-height bands → jsPDF pages (A4/Letter)
7. Blob → md5 → upload (unchanged) → notify
```

---

## Features

> Each feature: Functional Requirements (FR), Acceptance Criteria (AC, Given/When/Then), Definition of Done (DoD).

### FP1 — Full Page capture mode + UI
- **FP1-FR1.** Revive `CaptureMode = 'reader' | 'fullpage'` (domain) and `settings.defaultMode` (`'reader'` default — Reader stays the recommended default).
- **FP1-FR2.** The popup offers a Full Page option for a one-off send; a context-menu item *Send to Supernote (Full Page)* is added alongside Reader.
- **FP1-FR3.** Full Page forces `format: 'pdf'` (a screenshot has no reflowable text; EPUB is not offered for this mode).
- **FP1-AC1.** Given Full Page selected, when sent, the page is captured as-is and uploaded as a PDF.
- **FP1-AC2.** Given `settings.defaultMode='fullpage'`, the toolbar send uses Full Page.
- **DoD:** mode/UI wired; defaults persisted; Reader unaffected; unit tests for mode resolution.

### FP2 — Scroll orchestration content script (no persistent mutation)
- **FP2-FR1.** A self-contained `scripting.executeScript` function measures `document.documentElement.scrollHeight`, `clientHeight`/`innerHeight`, `devicePixelRatio`, and the scroll width, and computes the ordered scroll offsets.
- **FP2-FR2.** It neutralizes `position: fixed` and `position: sticky` elements (set `position: static`) before capture so headers/banners don't repeat on each tile, recording originals.
- **FP2-FR3.** At each step it scrolls, awaits a paint (`requestAnimationFrame`) and a short lazy-load settle, then signals readiness so the background captures that viewport.
- **FP2-FR4.** It **restores** the original scroll position and all mutated styles in a `finally` — even on error/timeout (capture must never leave the user's page altered — the I-4 principle).
- **FP2-AC1.** Given a multi-screen page, the computed offsets cover `[0 … totalHeight]` with no gap and a clamped final step.
- **FP2-AC2.** Given capture completes or throws, the page's scroll position and element styles are exactly as before (verified).
- **DoD:** the offset/geometry math is extracted to a pure, unit-tested helper (the executeScript fn is `c8 ignore`d like other injected fns); restoration verified.

### FP3 — Tile capture via captureVisibleTab (throttled)
- **FP3-FR1.** The background captures each viewport with `api.tabs.captureVisibleTab` (PNG), gated by `activeTab` (no new host permission).
- **FP3-FR2.** Captures are **throttled** to the browser's per-second quota (`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`) with a small inter-capture delay to avoid `MAX_CAPTURE…` errors.
- **FP3-FR3.** A capture failure on a tile retries once; persistent failure fails the job with an actionable message (no partial silent upload).
- **FP3-AC1.** Given an N-viewport page, exactly N tiles are captured in order without quota errors.
- **DoD:** throttle + ordering covered by unit tests against a faked capture port; rate-limit handling verified.

### FP4 — Target-gated stitch core
- **FP4-FR1.** `src/conversion/fullpage-stitch.ts` (new) exposes pure geometry (`planFullPage(geometry)` → canvas size, per-tile draw rects, page slices) — unit-tested, `chrome`-free.
- **FP4-FR2.** A DOM stitch step composites tiles onto a canvas (`devicePixelRatio`-aware; last tile clipped to avoid overlap) and produces the page-sliced images. It runs **target-gated** (offscreen document on Chrome, event page on Firefox) reusing the FF4 split.
- **FP4-FR3.** Respect the canvas max dimension: if `totalHeight·dpr` exceeds the cap, stitch in bands so no single canvas exceeds the limit.
- **FP4-AC1.** Given ordered tiles + geometry, the stitched output reproduces the page top-to-bottom with no duplicated/overlapping bands.
- **DoD:** `planFullPage` fully unit-tested (happy-dom for the canvas-bound part; the DOM stitch glue is `c8 ignore`d); 100% coverage on the pure planner.

### FP5 — Paginate to PDF + naming
- **FP5-FR1.** Slice the stitched image into page-height bands and place each on a jsPDF page (A4/Letter from `pageSize`), producing `application/pdf` bytes via the existing render adapter path.
- **FP5-FR2.** Filename derives from the page title via the existing `derive-filename` (sanitized/deduped) — unchanged.
- **FP5-FR3.** Optional secondary output: a single tall PNG (behind a setting; default PDF).
- **FP5-AC1.** Given a 3-viewport page, the PDF has the expected page count and the bands tile the full height in order.
- **DoD:** pagination math unit-tested; output opens in a standard PDF reader and on-device (or documented untested).

### FP6 — Bounds, timeouts, partial success
- **FP6-FR1.** A **max-pages/max-height cap** (configurable; sensible default) bounds runaway captures; when truncated, notify the user that the page was capped.
- **FP6-FR2.** A **capture timeout** bounds the whole operation; on timeout, fail cleanly (page restored) with an actionable message.
- **FP6-FR3.** Inner-scroll/SPA pages where `scrollTo` doesn't move the document are detected (no new tiles) and fall back to a single-viewport capture with a note, rather than looping.
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
- **IP-3.** The upload/delivery/jobs/notification pipeline is unchanged — Full Page yields a blob exactly like Reader.
- **IP-4.** Cross-browser parity — the only target difference is where the canvas stitch runs (offscreen vs event page), via the existing FF4 gate; the Firefox bundle stays offscreen-free.
- **IP-5.** Output is an image-based PDF (a screenshot) — honest "as-is", not searchable text.

## Edge Cases
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
- **Performance:** capture of a typical multi-screen page completes in a few seconds (bounded by the capture quota and the timeout); progress is reflected via the badge/notifications.
- **Footprint:** no new runtime dependency — reuses jsPDF (bundled) and the canvas. (html2canvas is not used by this feature.)
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
| `src/capture/capture-fullpage.ts` *(new)* | Orchestrate measure→scroll→capture→tiles (background); pure offset/geometry helper extracted (FP2/FP3) |
| `src/conversion/fullpage-stitch.ts` *(new)* | Pure `planFullPage(geometry)` + DOM stitch→paginate; reuses jsPDF (FP4/FP5) |
| `src/background/*` (offscreen dispatcher + Firefox direct path) | Route the stitch via the FF4 `__TARGET__` split (FP4-FR2/FP7) |
| `src/popup/*`, `src/options/*`, `src/background/context-menus.ts` | Full Page option + context-menu item + default mode (FP1) |
| `src/jobs/resolve-send-request.ts`, `triggers.ts` | Mode routing for Full Page (reuse) |
| `README.md`, Options copy | Fidelity disclosure (FP8) |
| `tests/**` | Unit (geometry/plan/throttle/restore) + integration (capture→stitch→PDF, both targets) |

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
