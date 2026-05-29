/**
 * In-memory BlobTransfer (F1-FR6, ADR-0006).
 *
 * The deterministic reference implementation of the binary handoff contract:
 * stores a defensive copy of the bytes under a generated handle and returns
 * them intact (F1-AC4: bytes match). Used as the test double and as a fallback
 * when IndexedDB is unavailable. Unlike the IndexedDB adapter it does NOT
 * survive a service-worker eviction, so the IndexedDB adapter is the default in
 * the service worker; this one keeps the contract honest and unit-testable.
 */
import type { BlobHandle, BlobTransfer, RandomSource } from '@shared/ports';

interface Entry {
  bytes: Uint8Array;
  contentType: string;
}

export class InMemoryBlobTransfer implements BlobTransfer {
  private readonly store = new Map<BlobHandle, Entry>();

  constructor(private readonly random: RandomSource) {}

  put(bytes: Uint8Array, contentType: string): Promise<BlobHandle> {
    const handle = this.random.uuid();
    // Defensive copy: the caller may reuse/mutate its buffer after handing off.
    this.store.set(handle, { bytes: bytes.slice(), contentType });
    return Promise.resolve(handle);
  }

  get(handle: BlobHandle): Promise<{ bytes: Uint8Array; contentType: string } | undefined> {
    const entry = this.store.get(handle);
    if (!entry) {
      return Promise.resolve(undefined);
    }
    // Return a copy so callers cannot mutate the stored bytes.
    return Promise.resolve({ bytes: entry.bytes.slice(), contentType: entry.contentType });
  }

  delete(handle: BlobHandle): Promise<void> {
    this.store.delete(handle);
    return Promise.resolve();
  }
}
