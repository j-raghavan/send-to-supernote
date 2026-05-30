// @vitest-environment happy-dom
/**
 * stitchFullPageToPdf (FP4-FR2 + FP5-FR1) — the DOM-bound stitch+paginate glue.
 *
 * Runs under happy-dom. `jspdf` is mocked at the module boundary (like
 * render-parse-core.test.ts mocks the renderers) so we assert the paginate
 * contract (one addImage per page slice, length-1 addPages, Uint8Array out)
 * rather than real PDF bytes. happy-dom lacks `OffscreenCanvas` /
 * `createImageBitmap`, so those are stubbed with recorders that let us assert
 * the dpr-aware draw + the final-tile clip, and drive the error branches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlobHandle } from '@shared/ports';

// ── jspdf mock (module boundary) ───────────────────────────────────────────
// Spies live at top level; the factory references them INSIDE function bodies
// that run later (not at hoist time), mirroring render-parse-core.test.ts.
const addImage = vi.fn();
const addPage = vi.fn();
const jsPDFCtor = vi.fn();
vi.mock('jspdf', () => ({
  jsPDF: function (this: unknown, ...args: unknown[]) {
    jsPDFCtor(...args);
    return {
      internal: { pageSize: { getWidth: () => 595.28, getHeight: () => 841.89 } },
      addImage,
      addPage,
      output: () => new ArrayBuffer(8),
    };
  },
}));

import {
  stitchFullPageToPdf,
  type StitchGeometry,
  type TileRef,
} from '@conversion/fullpage-stitch-core';

// ── Canvas / bitmap stubs ──────────────────────────────────────────────────

/** Per-context drawImage recorder shared so a test can inspect the draws. */
interface DrawCall {
  args: unknown[];
}

/**
 * Install OffscreenCanvas/createImageBitmap stubs. `ctxFactory` lets a test
 * return `null` (to hit the `!ctx` throw) or a recorder ctx. `bitmapDims`
 * controls the decoded bitmap size so the clip path can be exercised.
 */
function installCanvasStubs(opts: {
  ctxFactory?: () => { drawImage: (...a: unknown[]) => void } | null;
  bitmapDims?: { width: number; height: number };
  drawCalls?: DrawCall[];
}): { close: ReturnType<typeof vi.fn> } {
  const drawCalls = opts.drawCalls ?? [];
  const defaultCtx = (): { drawImage: (...a: unknown[]) => void } => ({
    drawImage: (...args: unknown[]): void => {
      drawCalls.push({ args });
    },
  });
  const close = vi.fn();

  class FakeOffscreenCanvas {
    constructor(
      public width: number,
      public height: number,
    ) {}
    getContext(_type: string): { drawImage: (...a: unknown[]) => void } | null {
      return opts.ctxFactory ? opts.ctxFactory() : defaultCtx();
    }
    convertToBlob(): Promise<Blob> {
      // A Blob whose arrayBuffer() resolves a couple of bytes for blobToDataUrl.
      return Promise.resolve({
        arrayBuffer: () => Promise.resolve(new Uint8Array([0x41, 0x42]).buffer),
      } as unknown as Blob);
    }
  }

  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  vi.stubGlobal('createImageBitmap', (_blob: Blob) =>
    Promise.resolve({
      width: opts.bitmapDims?.width ?? 800,
      height: opts.bitmapDims?.height ?? 600,
      close,
    }),
  );
  return { close };
}

/** A `resolve` that always returns a few bytes for any handle. */
const resolveBytes = (_h: BlobHandle): Promise<Uint8Array> =>
  Promise.resolve(new Uint8Array([1, 2, 3]));

function geom(over: Partial<StitchGeometry>): StitchGeometry {
  return {
    totalHeight: 5000,
    viewportHeight: 600,
    width: 800,
    dpr: 1,
    pageSize: 'a4',
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('stitchFullPageToPdf — paginate contract (FP4-FR2 + FP5-FR1)', () => {
  beforeEach(() => {
    addImage.mockClear();
    addPage.mockClear();
    jsPDFCtor.mockClear();
  });

  it('adds one image per page slice and (slices-1) pages; returns a Uint8Array', async () => {
    installCanvasStubs({});
    // a4 dpr=1, totalHeight=5000 → 2 page slices ([0,3508],[3508,1492]).
    const tiles: TileRef[] = [{ handle: 'h0', offsetY: 0 }];
    const out = await stitchFullPageToPdf(tiles, geom({}), resolveBytes);

    expect(out).toBeInstanceOf(Uint8Array);
    expect(addImage).toHaveBeenCalledTimes(2); // one per slice
    expect(addPage).toHaveBeenCalledTimes(1); // slices - 1
    // jsPDF constructed with the a4 format.
    expect(jsPDFCtor).toHaveBeenCalledWith({ unit: 'pt', format: 'a4' });
  });

  it('routes letter through jsPDF with the letter format and single-slice page', async () => {
    installCanvasStubs({});
    // letter dpr=1, totalHeight=1000 → 1 page slice, no addPage.
    const out = await stitchFullPageToPdf(
      [{ handle: 'h0', offsetY: 0 }],
      geom({ totalHeight: 1000, pageSize: 'letter' }),
      resolveBytes,
    );
    expect(out).toBeInstanceOf(Uint8Array);
    expect(addImage).toHaveBeenCalledTimes(1);
    expect(addPage).not.toHaveBeenCalled();
    expect(jsPDFCtor).toHaveBeenCalledWith({ unit: 'pt', format: 'letter' });
  });

  it('clamps the per-page render height to the page height (renderHeightPt cap)', async () => {
    installCanvasStubs({});
    // width=1, dpr=1 → widthPx=1, so renderHeightPt = slice.height/1 * pageWidthPt
    // is huge and must be clamped to pageHeightPt (841.89) for every page.
    await stitchFullPageToPdf(
      [{ handle: 'h0', offsetY: 0 }],
      geom({ width: 1, totalHeight: 1000 }),
      resolveBytes,
    );
    // 5th positional arg of addImage is the height; expect it clamped to 841.89.
    const heightArg = addImage.mock.calls[0]![5] as number;
    expect(heightArg).toBe(841.89);
  });
});

describe('stitchFullPageToPdf — tile drawing (dpr-aware, clip)', () => {
  beforeEach(() => {
    addImage.mockClear();
    addPage.mockClear();
  });

  it('draws each in-bounds tile at its dpr-scaled destination Y', async () => {
    const drawCalls: DrawCall[] = [];
    installCanvasStubs({ drawCalls, bitmapDims: { width: 800, height: 600 } });
    // dpr=2 so destY = round(offsetY * 2). offsetY=100 → destY=200.
    await stitchFullPageToPdf(
      [{ handle: 'h0', offsetY: 100 }],
      geom({ totalHeight: 5000, dpr: 2 }),
      resolveBytes,
    );
    // First drawImage is the tile composite onto the tall canvas:
    // drawImage(bitmap, 0,0, w, drawHeight, 0, destY, w, drawHeight).
    const tileDraw = drawCalls[0]!.args;
    expect(tileDraw[6]).toBe(200); // destY = round(100 * 2)
  });

  it('clips the final/bottom tile so it never overruns totalDeviceHeight', async () => {
    const drawCalls: DrawCall[] = [];
    // bitmap.height=600 but only (10000 - 9700)=300 px remain below destY.
    installCanvasStubs({ drawCalls, bitmapDims: { width: 800, height: 600 } });
    // a4 dpr=1, totalHeight=10000 → totalDeviceHeight=10000. offsetY=9700 → destY=9700.
    // drawHeight = min(600, 10000-9700) = 300 (clipped).
    await stitchFullPageToPdf(
      [{ handle: 'h0', offsetY: 9700 }],
      geom({ totalHeight: 10000, dpr: 1 }),
      resolveBytes,
    );
    const tileDraw = drawCalls[0]!.args;
    // Source-rect height (arg 4) and dest-rect height (arg 8) are both clipped.
    expect(tileDraw[4]).toBe(300);
    expect(tileDraw[8]).toBe(300);
    expect(tileDraw[6]).toBe(9700); // destY
  });

  it('skips an off-canvas tile (destY >= totalDeviceHeight) without drawing or resolving', async () => {
    const drawCalls: DrawCall[] = [];
    installCanvasStubs({ drawCalls });
    const resolve = vi.fn(resolveBytes);
    // totalDeviceHeight=1000. offsetY=2000, dpr=1 → destY=2000 >= 1000 → skipped.
    // Add an in-bounds tile too so we still draw exactly once.
    await stitchFullPageToPdf(
      [
        { handle: 'in', offsetY: 0 },
        { handle: 'off', offsetY: 2000 },
      ],
      geom({ totalHeight: 1000, dpr: 1 }),
      resolve,
    );
    // resolve called only for the in-bounds tile; the off tile never resolved.
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith('in');
    // Exactly one tile composite onto the tall canvas: the only draw whose first
    // arg is a decoded bitmap (our stub bitmaps expose `close`); slice draws pass
    // the canvas instead.
    const tileComposites = drawCalls.filter(
      (c) => typeof (c.args[0] as { close?: unknown })?.close === 'function',
    );
    expect(tileComposites.length).toBe(1);
  });

  it('treats dpr <= 0 as 1 when scaling the tile destination (dpr guard)', async () => {
    const drawCalls: DrawCall[] = [];
    installCanvasStubs({ drawCalls, bitmapDims: { width: 800, height: 600 } });
    // dpr=0 → 1, so destY = round(offsetY * 1) = offsetY (200), not 0.
    await stitchFullPageToPdf(
      [{ handle: 'h0', offsetY: 200 }],
      geom({ totalHeight: 5000, dpr: 0 }),
      resolveBytes,
    );
    const tileDraw = drawCalls[0]!.args;
    expect(tileDraw[6]).toBe(200); // destY scaled by the guarded dpr of 1
  });

  it('closes each decoded bitmap after compositing it', async () => {
    const { close } = installCanvasStubs({});
    await stitchFullPageToPdf(
      [{ handle: 'h0', offsetY: 0 }],
      geom({ totalHeight: 1000 }),
      resolveBytes,
    );
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('stitchFullPageToPdf — error branches', () => {
  beforeEach(() => {
    addImage.mockClear();
    addPage.mockClear();
  });

  it('throws when the tall-canvas 2D context is unavailable (!ctx)', async () => {
    // First getContext returns null → the tall-canvas ctx throw.
    installCanvasStubs({ ctxFactory: () => null });
    await expect(
      stitchFullPageToPdf(
        [{ handle: 'h0', offsetY: 0 }],
        geom({ totalHeight: 1000 }),
        resolveBytes,
      ),
    ).rejects.toThrow('fullpage-stitch: 2D canvas context unavailable');
  });

  it('throws when a slice 2D context is unavailable', async () => {
    // The tall canvas (call #1) gets a real ctx; the first slice (call #2) → null.
    let n = 0;
    installCanvasStubs({
      ctxFactory: () => {
        n += 1;
        return n === 1 ? { drawImage: vi.fn() } : null;
      },
    });
    await expect(
      stitchFullPageToPdf(
        [{ handle: 'h0', offsetY: 0 }],
        geom({ totalHeight: 1000 }),
        resolveBytes,
      ),
    ).rejects.toThrow('fullpage-stitch: 2D slice context unavailable');
  });

  it('throws when tile bytes cannot be resolved (missing handle)', async () => {
    installCanvasStubs({});
    const resolve = (_h: BlobHandle): Promise<Uint8Array | undefined> => Promise.resolve(undefined);
    await expect(
      stitchFullPageToPdf([{ handle: 'gone', offsetY: 0 }], geom({ totalHeight: 1000 }), resolve),
    ).rejects.toThrow('fullpage-stitch: missing tile bytes for handle gone');
  });
});
