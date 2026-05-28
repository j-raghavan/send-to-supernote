# ADR-0005: Offscreen document for DOM rendering, single-instance lifecycle

- Status: accepted
- Date: 2026-05-27
- Deciders: Architect agent

## Context and Problem Statement

MV3 service workers have no DOM, but Reader/Full-Page conversion needs DOM APIs (Readability output
to PDF via jsPDF; `html2canvas` rasterization). `chrome.offscreen` allows exactly **one** offscreen
document at a time, created with declared `reasons`. Where does rendering run, and who owns its
lifecycle (F1-FR5/FR6, F3, F4)?

## Decision Drivers

- No DOM in the SW; rendering must run somewhere DOM-capable (F1-FR5).
- Only one offscreen doc may exist; it must be created on demand and closed after use.
- Offscreen has only `chrome.runtime` among extension APIs → all orchestration stays in the SW (F1-FR6).
- Rendering must be unit-testable without a real browser.

## Decision Outcome

Chosen: rendering runs in the **offscreen document** (`src/offscreen/`) behind a `Renderer` port. The
service worker owns the lifecycle via `background/offscreen-manager.ts`: create-before-render (with
explicit `reasons`: `DOM_PARSER`, `BLOBS`, and `IFRAME_SCRIPTING` if sandboxed rendering is used),
close-after. The manager enforces single-instance (reuse-or-create, never create a second). The pure
render logic (`render-document.ts` use case, pagination/image-skip decisions) lives in the
`conversion` context and is unit-tested against a fake `Renderer`; the offscreen adapter
(`pdf-renderer.ts`, `epub-renderer.ts`, `canvas-raster.ts`) is the thin DOM-bound layer. The
offscreen doc returns bytes only; it does no auth/upload/job work.

### Consequences

- Good: SW stays orchestration-only (F1-FR6); render decisions are pure-testable.
- Good: single-instance + reasons enforced in one place (F1-AC3).
- Bad/Cost: an extra message hop SW↔offscreen; mitigated by the binary handoff in ADR-0006.
- Edge: offscreen create/close failure → retry once, else fail the job (spec Edge Cases) — handled
  in the manager + saga.

## More Information

`docs/ddd/architecture.md` §2, §6 (F1/F3/F4), §7. Spec F1-FR5/FR6, Edge Cases.
