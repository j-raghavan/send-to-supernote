/**
 * DirectRenderer (FF2-FR1, FF2-FR6, FF2-AC4, FF2-AC5, I-F7) — the Firefox render
 * adapter.
 *
 * It delegates the render to the shared `renderToBytes`, derives the content type
 * via `contentTypeFor`, stores the bytes via the injected `BlobTransfer`, and
 * returns the `RenderedBlob` handle (FF2-FR1/FR6). We inject the deterministic
 * `InMemoryBlobTransfer` (FakeRandomSource) and mock the `renderToBytes` boundary
 * so the adapter's storage/handle contract is tested without invoking real
 * PDF/EPUB generation. FF2-AC4: the handle round-trips the SAME bytes back.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { resolveRenderOptions } from '@domain/conversion';
import { InMemoryBlobTransfer } from '../../../src/background/in-memory-blob-transfer';
import { FakeRandomSource } from '../../fakes/fake-random-source';

const renderToBytes = vi.fn<(html: string, options: unknown) => Promise<Uint8Array>>();
vi.mock('@conversion/render-parse-core', () => ({
  renderToBytes: (html: string, options: unknown) => renderToBytes(html, options),
}));

import { DirectRenderer } from '../../../src/background/direct-renderer';

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await webcrypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('DirectRenderer (FF2-FR1/FR6, FF2-AC4)', () => {
  afterEach(() => {
    renderToBytes.mockReset();
  });

  it('renders → stores → returns a RenderedBlob with the PDF content type and byteLength', async () => {
    const bytes = new Uint8Array([10, 20, 30, 40, 50]);
    renderToBytes.mockResolvedValue(bytes);
    const blobs = new InMemoryBlobTransfer(new FakeRandomSource());
    const options = resolveRenderOptions('pdf');

    const result = await new DirectRenderer(blobs).render('<p>html</p>', options);

    expect(renderToBytes).toHaveBeenCalledWith('<p>html</p>', options);
    expect(result.contentType).toBe('application/pdf'); // contentTypeFor('pdf')
    expect(result.size).toBe(bytes.byteLength);
    expect(typeof result.handle).toBe('string');
  });

  it('uses the EPUB content type for an EPUB render', async () => {
    renderToBytes.mockResolvedValue(new Uint8Array([1, 2]));
    const blobs = new InMemoryBlobTransfer(new FakeRandomSource());

    const result = await new DirectRenderer(blobs).render('<p>h</p>', resolveRenderOptions('epub'));

    expect(result.contentType).toBe('application/epub+zip');
    expect(result.size).toBe(2);
  });

  it('round-trips the SAME bytes back via the blob handle (FF2-AC4 — digest equal)', async () => {
    // ~2 MB of varied bytes, the payload kind that cannot cross sendMessage.
    const bytes = new Uint8Array(2 * 1024 * 1024).map((_v, i) => (i * 17 + 3) % 256);
    const before = await sha256Hex(bytes);
    renderToBytes.mockResolvedValue(bytes);
    const blobs = new InMemoryBlobTransfer(new FakeRandomSource());

    const result = await new DirectRenderer(blobs).render(
      '<p>big</p>',
      resolveRenderOptions('pdf'),
    );
    const stored = await blobs.get(result.handle);

    expect(stored).toBeDefined();
    expect(stored?.contentType).toBe('application/pdf');
    expect(stored?.bytes.byteLength).toBe(bytes.byteLength);
    expect(result.size).toBe(bytes.byteLength);
    expect(await sha256Hex(stored!.bytes)).toBe(before);
  });
});
