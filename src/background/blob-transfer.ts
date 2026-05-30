/**
 * IndexedDB-backed BlobTransfer adapter (F1-FR6, ADR-0006).
 *
 * Thin wrapper over IndexedDB: the offscreen renderer stores rendered bytes and
 * returns a handle; the service worker reads the bytes when it needs them for
 * upload and deletes the entry after finish (or on prune). IndexedDB persists
 * across a service-worker eviction so a job can resume at `uploading` without
 * re-rendering (F9-FR5).
 *
 * This file contains no decision-bearing branching — only the mechanical
 * IndexedDB calls. The transfer *contract* (round-trip integrity) is verified
 * against the in-memory implementation of the same port. Coverage-excluded
 * (architecture §9.3): IndexedDB is unavailable in the unit-test (node) runtime.
 */
/* c8 ignore start */
import type { BlobHandle, BlobTransfer } from '@shared/ports';

const DB_NAME = 'send-to-supernote';
const STORE = 'blobs';
const DB_VERSION = 1;

interface StoredBlob {
  bytes: ArrayBuffer;
  contentType: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (): void => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error ?? new Error('indexedDB open failed'));
  });
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    // Resolve only when the TRANSACTION COMMITS (`oncomplete`), not merely when
    // the request succeeds (`onsuccess`). `onsuccess` fires before the write is
    // durable, so a writer could hand back a handle while the commit is still
    // pending — and the offscreen document that wrote it is closed immediately
    // after render (OffscreenRenderer.release()). If that teardown raced ahead of
    // the commit, the bytes were lost and the service worker's get() returned
    // undefined → "Rendered blob missing". Committing first removes the race.
    request.onerror = (): void => reject(request.error ?? new Error('indexedDB request failed'));
    transaction.oncomplete = (): void => resolve(request.result);
    transaction.onabort = (): void =>
      reject(transaction.error ?? new Error('indexedDB transaction aborted'));
    transaction.onerror = (): void =>
      reject(transaction.error ?? new Error('indexedDB transaction failed'));
  });
}

export class IndexedDbBlobTransfer implements BlobTransfer {
  async put(bytes: Uint8Array, contentType: string): Promise<BlobHandle> {
    const db = await openDb();
    const handle = crypto.randomUUID();
    const copy = bytes.slice();
    const stored: StoredBlob = { bytes: copy.buffer, contentType };
    await tx(db, 'readwrite', (store) => store.put(stored, handle));
    db.close();
    return handle;
  }

  async get(handle: BlobHandle): Promise<{ bytes: Uint8Array; contentType: string } | undefined> {
    const db = await openDb();
    const stored = await tx<StoredBlob | undefined>(
      db,
      'readonly',
      (store) => store.get(handle) as IDBRequest<StoredBlob | undefined>,
    );
    db.close();
    if (!stored) {
      return undefined;
    }
    return { bytes: new Uint8Array(stored.bytes), contentType: stored.contentType };
  }

  async delete(handle: BlobHandle): Promise<void> {
    const db = await openDb();
    await tx(db, 'readwrite', (store) => store.delete(handle));
    db.close();
  }
}
/* c8 ignore stop */
