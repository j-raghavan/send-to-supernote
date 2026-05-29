import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryBlobTransfer } from '../../../src/background/in-memory-blob-transfer';
import { FakeRandomSource } from '../../fakes/fake-random-source';

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await webcrypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('InMemoryBlobTransfer (F1-FR6 / F1-AC4)', () => {
  let transfer: InMemoryBlobTransfer;

  beforeEach(() => {
    transfer = new InMemoryBlobTransfer(new FakeRandomSource());
  });

  it('round-trips multi-MB bytes intact (digest equal — F1-AC4)', async () => {
    // ~3 MB of varied bytes, the kind of payload that cannot cross sendMessage.
    const bytes = new Uint8Array(3 * 1024 * 1024).map((_v, i) => (i * 31 + 7) % 256);
    const before = await sha256Hex(bytes);

    const handle = await transfer.put(bytes, 'application/pdf');
    const out = await transfer.get(handle);

    expect(out).toBeDefined();
    expect(out?.contentType).toBe('application/pdf');
    expect(await sha256Hex(out!.bytes)).toBe(before);
    expect(out?.bytes.byteLength).toBe(bytes.byteLength);
  });

  it('stores a defensive copy (mutating the source after put does not change stored bytes)', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const handle = await transfer.put(bytes, 'application/pdf');
    bytes[0] = 99;
    const out = await transfer.get(handle);
    expect(Array.from(out!.bytes)).toEqual([1, 2, 3, 4]);
  });

  it('returns a copy on get (mutating the result does not change stored bytes)', async () => {
    const handle = await transfer.put(new Uint8Array([5, 6, 7]), 'application/pdf');
    const first = await transfer.get(handle);
    first!.bytes[0] = 0;
    const second = await transfer.get(handle);
    expect(Array.from(second!.bytes)).toEqual([5, 6, 7]);
  });

  it('returns undefined for an unknown handle', async () => {
    expect(await transfer.get('missing')).toBeUndefined();
  });

  it('deletes stored bytes', async () => {
    const handle = await transfer.put(new Uint8Array([1]), 'application/pdf');
    await transfer.delete(handle);
    expect(await transfer.get(handle)).toBeUndefined();
  });

  it('delete on an unknown handle is a no-op', async () => {
    await expect(transfer.delete('nope')).resolves.toBeUndefined();
  });
});
