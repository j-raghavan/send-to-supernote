/**
 * DirectStitcher (FP4-FR2, FF4-parity) — the Firefox stitch adapter.
 *
 * It delegates the stitch to the shared `stitchFullPageToPdf` (no offscreen doc
 * on Firefox — parity with `DirectRenderer`/FF2-FR6), resolves each tile handle
 * to bytes through the injected `BlobTransfer`, stores the resulting PDF bytes,
 * and returns the `RenderedBlob` handle (FP3-FR4). We inject the deterministic
 * `InMemoryBlobTransfer` (FakeRandomSource) and mock the `stitchFullPageToPdf`
 * boundary so the adapter's resolver/storage/handle contract is tested without
 * running real canvas/jsPDF stitching. The captured `resolve` round-trips the
 * SAME bytes back through the blob handle (and `undefined` for an unknown one).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BlobHandle } from '@shared/ports';
import type * as StitchCore from '@conversion/fullpage-stitch-core';
import { type StitchGeometry, type TileRef } from '@conversion/fullpage-stitch-core';
import { InMemoryBlobTransfer } from '../../../src/background/in-memory-blob-transfer';
import { FakeRandomSource } from '../../fakes/fake-random-source';

type StitchResolve = (h: BlobHandle) => Promise<Uint8Array | undefined>;

const stitchFullPageToPdf =
  vi.fn<
    (
      tiles: TileRef[],
      geometry: StitchGeometry,
      resolve: StitchResolve,
      cap: unknown,
    ) => Promise<Uint8Array>
  >();

vi.mock('@conversion/fullpage-stitch-core', async (importActual) => {
  const actual = await importActual<typeof StitchCore>();
  return {
    ...actual, // keep the real DEFAULT_CAP (and the types).
    stitchFullPageToPdf: (
      tiles: TileRef[],
      geometry: StitchGeometry,
      resolve: StitchResolve,
      cap: unknown,
    ) => stitchFullPageToPdf(tiles, geometry, resolve, cap),
  };
});

import { DEFAULT_CAP } from '@conversion/fullpage-stitch-core';
import { DirectStitcher } from '../../../src/background/direct-stitcher';

const TILES: TileRef[] = [
  { handle: 'tile-a', offsetY: 0 },
  { handle: 'tile-b', offsetY: 800 },
];

const GEOMETRY: StitchGeometry = {
  totalHeight: 1600,
  viewportHeight: 800,
  width: 1024,
  dpr: 2,
  pageSize: 'a4',
};

describe('DirectStitcher (FP4-FR2, FF4-parity)', () => {
  afterEach(() => {
    stitchFullPageToPdf.mockReset();
  });

  it('stitches → stores → returns a RenderedBlob with the PDF content type and byteLength', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 1, 2, 3]); // "%PDF" + payload
    stitchFullPageToPdf.mockResolvedValue(bytes);
    const blobs = new InMemoryBlobTransfer(new FakeRandomSource());

    const result = await new DirectStitcher(blobs).stitch(TILES, GEOMETRY);

    // Called exactly once with (tiles, geometry, <a resolver fn>, DEFAULT_CAP).
    expect(stitchFullPageToPdf).toHaveBeenCalledTimes(1);
    const [tilesArg, geometryArg, resolveArg, capArg] = stitchFullPageToPdf.mock.calls[0]!;
    expect(tilesArg).toBe(TILES);
    expect(geometryArg).toBe(GEOMETRY);
    expect(typeof resolveArg).toBe('function');
    expect(capArg).toBe(DEFAULT_CAP);

    expect(result.contentType).toBe('application/pdf');
    expect(result.size).toBe(bytes.byteLength);
    expect(typeof result.handle).toBe('string');
  });

  it('the resolver passed to stitchFullPageToPdf round-trips tile bytes through the blob handle', async () => {
    stitchFullPageToPdf.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const blobs = new InMemoryBlobTransfer(new FakeRandomSource());

    await new DirectStitcher(blobs).stitch(TILES, GEOMETRY);

    const resolve = stitchFullPageToPdf.mock.calls[0]![2];

    // Put a tile's bytes, then resolve its handle → the SAME bytes come back.
    const tileBytes = new Uint8Array([9, 8, 7, 6, 5]);
    const handle = await blobs.put(tileBytes, 'image/png');
    const resolved = await resolve(handle);
    expect(resolved).toBeDefined();
    expect([...resolved!]).toEqual([...tileBytes]);

    // An unknown handle resolves to undefined.
    expect(await resolve('no-such-handle')).toBeUndefined();
  });
});
