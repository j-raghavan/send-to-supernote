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
const setProperties = vi.fn();
const setPage = vi.fn();
const setFillColor = vi.fn();
const rect = vi.fn();
const setTextColor = vi.fn();
const setFontSize = vi.fn();
const text = vi.fn();
vi.mock('jspdf', () => ({
  jsPDF: function (this: unknown, ...args: unknown[]) {
    jsPDFCtor(...args);
    return {
      internal: { pageSize: { getWidth: () => 595.28, getHeight: () => 841.89 } },
      addImage,
      addPage,
      setProperties,
      setPage,
      setFillColor,
      rect,
      setTextColor,
      setFontSize,
      text,
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

/** Minimal 2D-context shape the stitcher uses: composite draws + the white fill. */
type CtxLike = {
  drawImage: (...a: unknown[]) => void;
  fillRect: (...a: unknown[]) => void;
  fillStyle?: string;
};

/** Records the `convertToBlob` MIME options so we can assert JPEG encoding. */
const convertToBlobCalls: { type?: string; quality?: number }[] = [];

/**
 * Install OffscreenCanvas/createImageBitmap stubs. `ctxFactory` lets a test
 * return `null` (to hit the `!ctx` throw) or a recorder ctx. `bitmapDims`
 * controls the decoded bitmap size so the clip path can be exercised.
 */
function installCanvasStubs(opts: {
  ctxFactory?: () => CtxLike | null;
  bitmapDims?: { width: number; height: number };
  drawCalls?: DrawCall[];
}): { close: ReturnType<typeof vi.fn> } {
  const drawCalls = opts.drawCalls ?? [];
  const defaultCtx = (): CtxLike => ({
    drawImage: (...args: unknown[]): void => {
      drawCalls.push({ args });
    },
    fillRect: (): void => {},
    fillStyle: '',
  });
  const close = vi.fn();

  class FakeOffscreenCanvas {
    constructor(
      public width: number,
      public height: number,
    ) {}
    getContext(_type: string): CtxLike | null {
      return opts.ctxFactory ? opts.ctxFactory() : defaultCtx();
    }
    convertToBlob(options?: { type?: string; quality?: number }): Promise<Blob> {
      convertToBlobCalls.push(options ?? {});
      // A Blob whose arrayBuffer() resolves a couple of bytes for blobToDataUrl.
      return Promise.resolve({
        type: options?.type ?? '',
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
  convertToBlobCalls.length = 0;
});

describe('stitchFullPageToPdf — paginate contract (FP4-FR2 + FP5-FR1)', () => {
  beforeEach(() => {
    addImage.mockClear();
    addPage.mockClear();
    jsPDFCtor.mockClear();
  });

  it('adds one JPEG image per page slice and (slices-1) pages; returns a Uint8Array', async () => {
    installCanvasStubs({});
    // a4 width 800 dpr 1: band=1131, totalHeight=5000 → tile(5000,1131) = 5 slices.
    const tiles: TileRef[] = [{ handle: 'h0', offsetY: 0 }];
    const out = await stitchFullPageToPdf(tiles, geom({}), resolveBytes);

    expect(out).toBeInstanceOf(Uint8Array);
    expect(addImage).toHaveBeenCalledTimes(5); // one per slice
    expect(addPage).toHaveBeenCalledTimes(4); // slices - 1
    // jsPDF constructed with the a4 format (real A4 page; band aspect matches it).
    expect(jsPDFCtor).toHaveBeenCalledWith({ unit: 'pt', format: 'a4' });
    // Bands are JPEG-encoded (size fix), not PNG: addImage format + convertToBlob MIME.
    expect(addImage.mock.calls[0]![1]).toBe('JPEG');
    expect(convertToBlobCalls.every((c) => c.type === 'image/jpeg')).toBe(true);
    expect(convertToBlobCalls[0]!.quality).toBe(0.85);
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

  it('renders a full slice at the page height and the remainder shorter (no vertical squish)', async () => {
    installCanvasStubs({});
    // a4 width 800 dpr 1: band=1131; totalHeight=1500 → slices [0,1131],[1131,369].
    // A full band has the page's aspect, so it maps on at ≈ pageHeightPt with NO
    // compression; the remainder slice is proportionally shorter (top-aligned).
    await stitchFullPageToPdf(
      [{ handle: 'h0', offsetY: 0 }],
      geom({ width: 800, totalHeight: 1500 }),
      resolveBytes,
    );
    const pageWidthPt = 595.28;
    const widthPx = 800;
    const fullH = addImage.mock.calls[0]![5] as number; // 5th positional arg = height
    const remH = addImage.mock.calls[1]![5] as number;
    // full slice: (1131/800)·595.28 ≈ 841.58, ≤ pageHeightPt(841.89) → not clamped.
    expect(fullH).toBeCloseTo((1131 / widthPx) * pageWidthPt, 2);
    expect(fullH).toBeLessThanOrEqual(841.89);
    // remainder: (369/800)·595.28 ≈ 274.6, clearly shorter than a full page.
    expect(remH).toBeCloseTo((369 / widthPx) * pageWidthPt, 2);
    expect(remH).toBeLessThan(fullH);
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
        return n === 1 ? { drawImage: vi.fn(), fillRect: vi.fn() } : null;
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

describe('stitchFullPageToPdf — provenance banner + metadata (CP6)', () => {
  const provenance = {
    sourceUrl: 'https://example.com/post',
    capturedAtMs: 1_750_000_000_000,
    timeZone: 'America/Los_Angeles',
  };

  beforeEach(() => {
    [
      addImage,
      addPage,
      setProperties,
      setPage,
      setFillColor,
      rect,
      setTextColor,
      setFontSize,
      text,
    ].forEach((s) => s.mockClear());
  });

  it('sets the source URL in subject and the capture time in keywords', async () => {
    installCanvasStubs({});
    await stitchFullPageToPdf(
      [{ handle: 'h0', offsetY: 0 }],
      geom({ totalHeight: 1000 }),
      resolveBytes,
      undefined,
      provenance,
    );
    expect(setProperties).toHaveBeenCalledTimes(1);
    const props = setProperties.mock.calls[0]![0] as { subject: string; keywords: string };
    expect(props.subject).toBe('https://example.com/post');
    expect(props.keywords).toContain('Captured');
  });

  it('draws the source/time banner on page 1', async () => {
    installCanvasStubs({});
    await stitchFullPageToPdf(
      [{ handle: 'h0', offsetY: 0 }],
      geom({ totalHeight: 1000 }),
      resolveBytes,
      undefined,
      provenance,
    );
    expect(setPage).toHaveBeenCalledWith(1);
    expect(rect).toHaveBeenCalledTimes(1); // the light background strip
    const drawn = text.mock.calls.map((c) => c[0] as string);
    expect(drawn.some((line) => line.startsWith('Source:'))).toBe(true);
    expect(drawn.some((line) => line.startsWith('Captured:'))).toBe(true);
  });

  it('draws nothing and sets no properties when provenance is absent (off-path)', async () => {
    installCanvasStubs({});
    await stitchFullPageToPdf(
      [{ handle: 'h0', offsetY: 0 }],
      geom({ totalHeight: 1000 }),
      resolveBytes,
    );
    expect(setProperties).not.toHaveBeenCalled();
    expect(setPage).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
  });
});
