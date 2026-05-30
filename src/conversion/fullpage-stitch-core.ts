/**
 * Full Page stitch/paginate core (FP4-FR1/FR2/FR3, FP5-FR1, FP6-FR1) — the
 * chrome-free home for the scroll-capture → tall-canvas → page-band PDF logic,
 * mirroring `render-parse-core.ts`.
 *
 * Two layers, separated so the geometry is 100% pure-testable and only the
 * canvas/jsPDF glue needs a DOM:
 *
 *   Part 1 — `planFullPage`: PURE arithmetic (no DOM, no chrome). Given the run
 *   geometry it computes the capped total device height, the canvas bands (each
 *   ≤ the cross-browser canvas max, FP4-FR3), the page-height slices for
 *   pagination (FP5), and whether the cap truncated the page (FP6-FR1).
 *
 *   Part 2 — `stitchFullPageToPdf`: DOM-bound. Resolves tile handles → bytes,
 *   draws them onto a (dpr-aware) canvas with the final tile clipped to avoid
 *   overlap, then `jsPDF.addImage`s one page-height band per PDF page
 *   (A4/Letter from `geometry.pageSize`). This rasterizes images — it is NOT
 *   `jsPDF.html()` (that is Reader's HTML layout path).
 *
 * Contains NO `chrome.*` / `@shared/browser-api` reference (like
 * render-parse-core.ts — `conversion` may touch DOM, just not the extension
 * namespace) and NO IndexedDB (handle resolution is injected via `resolve`).
 */
import type { PageGeometry } from '@capture/fullpage-plan';
import type { PageSize } from '@domain/conversion';
import type { BlobHandle } from '@shared/ports';
import { jsPDF } from 'jspdf';

// ──────────────────────────────────────────────────────────────────────────
// Part 1 — pure planner (no DOM)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Conservative cross-browser canvas max dimension; bands never exceed this
 * (device px). Real browser limits range ~16k–32k px; 16384 is the safe floor.
 */
export const CANVAS_MAX_PX = 16384;

export interface FullPageCap {
  maxPages: number;
  maxHeightPx: number;
}

/**
 * ~50 pages worth of canvas as an absolute memory/file guard. The page-count cap
 * (`maxPages`) is the limit users actually hit; `maxHeightPx` only binds for
 * unusually WIDE captures (where `50 · pageHeightPx` would exceed it), keeping a
 * very tall canvas safe. `50 * 3508` is a deliberately round device-px ceiling.
 */
export const DEFAULT_CAP: FullPageCap = { maxPages: 50, maxHeightPx: 50 * 3508 };

/**
 * Portrait page aspect (height ÷ width): A4 is 297⁄210, Letter 11⁄8.5. The page
 * band height is derived from the CAPTURE WIDTH times this ratio (see
 * `planFullPage`), NOT a fixed 300-dpi height. That is the whole legibility fix:
 * a width-proportional band has the SAME aspect as the PDF page, so it maps on
 * with one uniform scale and zero vertical compression. The old fixed
 * `PAGE_BASE_PX` basis (3508 px ≈ 2.7 viewports) crammed far too much height into
 * each page and the `renderHeightPt` clamp then squashed it — the "tiny, squished
 * fonts" bug. Width-proportional pages reproduce the desktop layout faithfully
 * and read at native-ish size after the device's fit-to-width.
 */
const PAGE_ASPECT: Record<PageSize, number> = { a4: 297 / 210, letter: 11 / 8.5 };

/**
 * JPEG quality for the page-band images — faithful fidelity at a fraction of
 * PNG's size (the prior full-PNG path produced ~46 MB for a few pages).
 */
const JPEG_QUALITY = 0.85;

export interface StitchGeometry extends PageGeometry {
  pageSize: PageSize;
}

/** A horizontal band of the stitched canvas (device px). */
export interface CanvasBand {
  startY: number;
  height: number;
}

/** A page-height slice of the stitched image, one per PDF page (device px). */
export interface PageSlice {
  sourceY: number;
  height: number;
}

export interface FullPagePlan {
  /** min(totalHeight * dpr, cap) — the canvas-safe, capped device height. */
  totalDeviceHeight: number;
  /** Canvas bands, each ≤ CANVAS_MAX_PX (FP4-FR3); last band is the remainder. */
  bands: CanvasBand[];
  /** Page-height slices tiling the device height (FP5); last slice the remainder. */
  pageSlices: PageSlice[];
  /** True when the cap (height or page count) clamped the page (FP6-FR1). */
  truncated: boolean;
}

/**
 * Split `[0, total)` into contiguous `{ start, height }` bands of at most
 * `chunk` px, the last band being the remainder. `total` is always ≥ 1 here
 * (clamped by `planFullPage`), so there is always at least one band.
 */
function tile(total: number, chunk: number): { start: number; height: number }[] {
  const out: { start: number; height: number }[] = [];
  for (let y = 0; y < total; y += chunk) {
    out.push({ start: y, height: Math.min(chunk, total - y) });
  }
  return out;
}

/**
 * Pure plan for stitching + paginating a full-page capture. All inputs are
 * numbers; every branch (cap-by-height, cap-by-pages, multi-band, single-band,
 * remainder slice, tiny/zero guard) is reachable from the arguments alone.
 */
export function planFullPage(g: StitchGeometry, cap: FullPageCap = DEFAULT_CAP): FullPagePlan {
  const dpr = g.dpr > 0 ? g.dpr : 1;
  // Page band height is the CAPTURE WIDTH (device px) × the page's portrait
  // aspect, so every band has the same aspect ratio as the PDF page and tiles on
  // with no vertical compression (the legibility fix — see PAGE_ASPECT).
  const widthDevicePx = Math.max(1, Math.round(Math.max(0, g.width) * dpr));
  const pageHeightPx = Math.max(1, Math.round(widthDevicePx * PAGE_ASPECT[g.pageSize]));

  // CSS height → device px, then clamp to BOTH caps (height and page count).
  const rawDeviceHeight = Math.max(0, g.totalHeight) * dpr;
  const pageCapHeight = cap.maxPages * pageHeightPx;
  const heightCap = Math.min(cap.maxHeightPx, pageCapHeight);
  const truncated = rawDeviceHeight > heightCap;
  // Guard zero/tiny heights: always at least one band/slice worth of canvas.
  const totalDeviceHeight = Math.max(1, Math.round(Math.min(rawDeviceHeight, heightCap)));

  return {
    totalDeviceHeight,
    bands: tile(totalDeviceHeight, CANVAS_MAX_PX).map((b) => ({
      startY: b.start,
      height: b.height,
    })),
    pageSlices: tile(totalDeviceHeight, pageHeightPx).map((s) => ({
      sourceY: s.start,
      height: s.height,
    })),
    truncated,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Part 2 — DOM stitch (canvas + jsPDF; happy-dom / mocked jspdf in tests)
// ──────────────────────────────────────────────────────────────────────────

/** An ordered tile: its stored PNG handle and its CSS-px scroll offset. */
export interface TileRef {
  handle: BlobHandle;
  offsetY: number; // CSS px
}

/** Map a PageSize to the jsPDF `format` string it expects. */
function jsPdfFormat(pageSize: PageSize): 'a4' | 'letter' {
  return pageSize;
}

/**
 * Decode stored PNG bytes into something `CanvasRenderingContext2D.drawImage`
 * accepts. `createImageBitmap` is the chrome-free, worker/offscreen-safe path
 * available in both the Chrome offscreen document and the Firefox event page.
 */
async function decodeTile(bytes: Uint8Array): Promise<ImageBitmap> {
  // Copy into a fresh ArrayBuffer-backed view so Blob gets a clean BlobPart.
  const blob = new Blob([bytes.slice()], { type: 'image/png' });
  return createImageBitmap(blob);
}

/**
 * Resolve tile handles → bytes, composite them onto a single dpr-aware canvas
 * (the final tile clipped so it never overruns `totalDeviceHeight`), then add
 * one page-height band per PDF page via `jsPDF.addImage` (NOT `jsPDF.html`).
 * Returns the PDF bytes as a `Uint8Array`, matching `pdf-renderer.ts`.
 *
 * Pure decisions (sizes, slice rects, page count) come from `planFullPage`; the
 * only DOM/jsPDF work here is decode → draw → addImage, so the planner stays
 * 100%-coverable and this glue is the lone happy-dom/mock surface.
 */
export async function stitchFullPageToPdf(
  tiles: TileRef[],
  geometry: StitchGeometry,
  resolve: (h: BlobHandle) => Promise<Uint8Array | undefined>,
  cap: FullPageCap = DEFAULT_CAP,
): Promise<Uint8Array> {
  const plan = planFullPage(geometry, cap);
  const dpr = geometry.dpr > 0 ? geometry.dpr : 1;
  const widthPx = Math.max(1, Math.round(Math.max(0, geometry.width) * dpr));

  // 1. Build the tall stitched canvas.
  const canvas = new OffscreenCanvas(widthPx, plan.totalDeviceHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('fullpage-stitch: 2D canvas context unavailable');
  }
  // Paint the canvas white first: JPEG has no alpha, so any region a tile does
  // not cover (e.g. below a clipped final tile) would otherwise flatten to black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthPx, plan.totalDeviceHeight);

  for (const tile of tiles) {
    const destY = Math.round(Math.max(0, tile.offsetY) * dpr);
    // Off-canvas tile (e.g. an extra tile past the cap) — nothing to draw.
    if (destY >= plan.totalDeviceHeight) {
      continue;
    }
    const bytes = await resolve(tile.handle);
    if (!bytes) {
      throw new Error(`fullpage-stitch: missing tile bytes for handle ${tile.handle}`);
    }
    const bitmap = await decodeTile(bytes);
    // Clip the source so the tile never overruns the (capped) canvas bottom —
    // this is what stops the last/overlapping tile from double-drawing.
    const drawHeight = Math.min(bitmap.height, plan.totalDeviceHeight - destY);
    ctx.drawImage(bitmap, 0, 0, bitmap.width, drawHeight, 0, destY, bitmap.width, drawHeight);
    bitmap.close();
  }

  // 2. Paginate: one page-height band → one PDF page via addImage.
  const pdf = new jsPDF({ unit: 'pt', format: jsPdfFormat(geometry.pageSize) });
  const pageWidthPt = pdf.internal.pageSize.getWidth();
  const pageHeightPt = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < plan.pageSlices.length; i += 1) {
    const slice = plan.pageSlices[i]!;
    const sliceCanvas = new OffscreenCanvas(widthPx, slice.height);
    const sliceCtx = sliceCanvas.getContext('2d');
    if (!sliceCtx) {
      throw new Error('fullpage-stitch: 2D slice context unavailable');
    }
    sliceCtx.drawImage(
      canvas,
      0,
      slice.sourceY,
      widthPx,
      slice.height,
      0,
      0,
      widthPx,
      slice.height,
    );
    const sliceBlob = await sliceCanvas.convertToBlob({
      type: 'image/jpeg',
      quality: JPEG_QUALITY,
    });
    const dataUrl = await blobToDataUrl(sliceBlob);

    if (i > 0) {
      pdf.addPage();
    }
    // Band aspect == page aspect (page height is width-proportional), so a full
    // slice maps on at exactly pageHeightPt; the final remainder slice is shorter.
    // `Math.min` is a defensive clamp against rounding overshoot.
    const renderHeightPt = (slice.height / widthPx) * pageWidthPt;
    pdf.addImage(dataUrl, 'JPEG', 0, 0, pageWidthPt, Math.min(renderHeightPt, pageHeightPt));
  }

  return new Uint8Array(pdf.output('arraybuffer'));
}

/** Read a JPEG Blob's bytes as a base64 data URL for `jsPDF.addImage`. */
async function blobToDataUrl(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  // Page bands are always JPEG-encoded (see the convertToBlob call above).
  return `data:image/jpeg;base64,${btoa(binary)}`;
}
