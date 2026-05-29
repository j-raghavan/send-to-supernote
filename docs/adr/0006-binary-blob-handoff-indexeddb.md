# ADR-0006: Binary blob handoff via IndexedDB handle

- Status: accepted
- Date: 2026-05-27
- Deciders: Architect agent

## Context and Problem Statement

Rendered PDFs/EPUBs can be multiple MB. F1-FR6 forbids passing them back from the offscreen document
to the service worker via `chrome.runtime.sendMessage` JSON (size/serialization limits). The chosen
mechanism must be binary-safe, consistent across F3/F4/F5/F8, and survive a service-worker eviction
mid-job (F9-FR5 / Edge Cases: resume from last completed step).

## Decision Drivers

- Binary-safe, multi-MB (F1-FR6 / F1-AC4: bytes intact, md5 equal).
- Consistent across all conversion/upload paths.
- Should help job persistence across SW restart (F9-FR5).

## Considered Options

1. **Write blob to IndexedDB in offscreen, pass a string handle to the SW; SW reads bytes.**
2. Transfer an `ArrayBuffer` via `postMessage` transferables.
3. Stream chunks over a `MessagePort`.

## Decision Outcome

Chosen: **Option 1 — IndexedDB handle**. The offscreen renderer writes the blob to an IndexedDB store
and returns a handle (id). The SW reads bytes via the `BlobTransfer` port (`background/blob-transfer.ts`)
when it needs them for upload, and deletes the entry after `finish` (or on prune). Domain/use-cases
only ever see a `BlobHandle` value; the in-memory fake implements the same port for tests.

Rationale over ArrayBuffer transfer (Option 2): a transferable lives only in memory and is lost if
the service worker is evicted between render and upload — but the job must resume after eviction
(F9-FR5). IndexedDB persists the bytes across the SW lifecycle, so the saga can resume at `uploading`
without re-rendering. Streaming (Option 3) is more moving parts than needed (KISS).

### Consequences

- Good: survives SW eviction → enables resume-from-step (F9-FR5) for free.
- Good: one `BlobHandle` abstraction across F3/F4/F5/F8; bytes verified by md5 (F1-AC4).
- Bad/Cost: must manage cleanup (delete after finish / on prune) to avoid storage growth — handled
  in `job-queue.ts`/`prune-stale.ts`. md5 equality is asserted in tests.

## More Information

`docs/ddd/architecture.md` §5 (BlobTransfer port), §7 (saga resume), §6 (F1-FR6/F9-FR5).
