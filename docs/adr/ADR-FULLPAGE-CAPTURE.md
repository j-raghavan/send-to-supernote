# ADR-FULLPAGE-CAPTURE: True "as-is" full-page capture via captureVisibleTab scroll+stitch

- Status: proposed
- Date: 2026-05-29
- Deciders: Firefox-support team (lead + architect)
- Extends: ADR-0001 (hexagonal), ADR-0005 (offscreen lifecycle), ADR-FIREFOX-PORT (target gating)
- Spec: `spec/SPEC-FULLPAGE-CAPTURE.md` (FP1–FP8)
- Supersedes deviation: the MVP's D-1 cut Full Page to Reader-only; this proposes reviving it with a different, higher-fidelity mechanism.

## Context and Problem Statement

The MVP is Reader-only: Mozilla Readability extracts the article and reflows it to EPUB/PDF, **losing the page's visual layout**. A user asked for GoFullPage-style behavior — capture the page **as it actually looks**, scrolling to grab the full height — and send that to Supernote.

The original Full Page mode (spec F4) was cut (D-1) because it used **`html2canvas`**, which *re-implements* CSS rendering in JS: it can't faithfully reproduce cross-origin images, web fonts, CSS transforms, `<canvas>`/video, or fixed/sticky elements. So "as-is fidelity" was never actually achievable that way.

There is **no WebExtension API that returns a full page in one call**: `tabs.captureVisibleTab` (Chrome) and `captureVisibleTab`/`captureTab` (Firefox) return **only the visible viewport** (verified: MDN). Full-page capture requires scrolling and stitching viewport tiles — which is exactly what GoFullPage does.

## Decision Drivers

- **True "as-is" fidelity** — the user wants the page as the browser renders it, not a reflow or a JS re-render.
- **Cross-browser** — must work on both the Chrome and Firefox builds (the port just shipped).
- **No alarming permissions** — `chrome.debugger`/print-to-PDF was a documented Non-Goal (scary "is debugging this browser" prompt + store-review risk) and is Chrome-only.
- **Reuse** — the capture→convert→upload→jobs pipeline, jsPDF (bundled), the FF4 target-gated render split, and `derive-filename` should be reused; the upload/delivery/jobs layers must not change.

## Decisions

### D1 — Mechanism: `tabs.captureVisibleTab` scroll+stitch (NOT html2canvas, NOT debugger)
Capture the page by scrolling it in viewport-height steps, calling `captureVisibleTab` at each step, and stitching the tiles into one tall image. This is the browser's **own** rendering (true pixel fidelity), works on Chrome and Firefox, and needs only `activeTab` (granted by the send click) — no new broad host permission.
- **Rejected — html2canvas:** best-effort DOM re-render; the documented fidelity ceiling (R-3) is precisely what the user is unhappy with. (It remains bundled today; this feature does not use it, and it could later be dropped if Reader mode stops needing it.)
- **Rejected — `chrome.debugger` `Page.captureScreenshot{captureBeyondViewport}`:** highest fidelity + no stitch seams, but requires the `debugger` permission (Non-Goal) and is Chrome-only (no Firefox).

### D2 — Split: content-script orchestration → background capture → target-gated stitch
- A **content script** (injected on demand via `scripting.executeScript`) measures the layout (`scrollHeight`, `clientHeight`, `devicePixelRatio`, scroll width), neutralizes `position: fixed/sticky` elements (so headers/banners don't repeat on every tile — restored afterwards), scrolls step-by-step (driven by the background), waits for paint + lazy-load at each step, and signals readiness via `runtime.sendMessage` (not `window.postMessage`). It **never persistently mutates** the page (scroll position and styles are restored — the I-4 "don't mutate the live page" principle).
- The **background** (event page / service worker) resolves the active tab's `windowId` (`tabs.get` — new wiring; not in the codebase today) and calls `captureVisibleTab` per step, **throttled** to the per-second quota (~2/sec on Chrome; conservative on Firefox). Each tile is **stored via `IndexedDbBlobTransfer` and carried as a handle** — full-viewport PNG data URLs are NOT forwarded through `runtime.sendMessage` (size/OOM; the F1-FR6 handoff rule). The background is **kept alive** (a long-lived `runtime.connect` Port) for the multi-second run so it doesn't idle-unload.
- A **target-gated stitch adapter** (reusing the FF4 `__TARGET__` split — offscreen document on Chrome, event-page DOM on Firefox) resolves the tile handles, composites onto a canvas, and **paginates to PDF via `jsPDF.addImage`** (raster bands — distinct from Reader's `jsPDF.html()` path). A tall PNG is an optional secondary output.

### D3 — Bounds and safety
Very tall pages exceed the browser canvas max dimension (~16k–32k px) and produce huge files. Enforce a **max page/height cap** (configurable) with a user-facing warning when truncated; a **capture timeout**; and graceful partial-success. Restore page scroll + styles in a `finally` even on error.

### D4 — A revived `fullpage` capture mode; upload/delivery/jobs unchanged, one new saga branch
Re-introduce `CaptureMode = 'reader' | 'fullpage'`, a Full Page option in the popup + a context-menu item, and `settings.defaultMode`. The **upload/delivery/jobs/notification** layers are unchanged — Full Page produces a blob the saga uploads like Reader's. The **one orchestration change** is a new `mode === 'fullpage'` branch in the send-job saga (`send-document.ts`), parallel to the existing `captureReader → renderDocument` branch (so implementers must not assume zero saga edits). `format` is forced to `pdf` for fullpage in `resolve-send-request`/the saga (not just the UI).

## Consequences

- **Good:** true "as-is" fidelity the user asked for; cross-browser; no scary permission; reuses jsPDF + the FF4 render split + the whole delivery/jobs pipeline.
- **Cost / known artifacts (must be documented in UI):** stitch boundaries can still show seams; `position: fixed/sticky` elements are neutralized to avoid repetition (so a fixed nav appears once, at top — a deliberate tradeoff); very tall pages are capped; horizontal overflow beyond the viewport width is clipped (matches GoFullPage); pages that scroll an inner container rather than the document need a best-effort fallback.
- **Rate limit:** `captureVisibleTab` is throttled by the browser; capture of a long page takes a few seconds (bounded, with progress).
- **Reversibility:** isolated behind the new mode; if fidelity proves insufficient, the mode can be disabled without touching Reader or the port.

## More Information
`spec/SPEC-FULLPAGE-CAPTURE.md`; MDN `tabs.captureVisibleTab`; GoFullPage (prior art); spec F4 (the removed html2canvas Full Page) and D-1 (why it was cut).
