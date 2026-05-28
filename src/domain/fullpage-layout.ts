/**
 * Full Page layout math (F4-FR3) — pure, no DOM.
 *
 * Two concerns, both arithmetic and fully testable:
 *  1. Scroll plan: the set of scroll offsets to visit before capture so lazy-
 *     loaded content is triggered (best-effort).
 *  2. Tiling: slice a tall rasterized canvas into page-height tiles for a
 *     paginated PDF, bounded by a max-pages cap (Edge Cases: extremely long
 *     page -> cap + warn).
 */

/** Compute scroll offsets (top of each viewport-height step) to trigger lazy load. */
export function scrollPlan(documentHeight: number, viewportHeight: number): number[] {
  if (viewportHeight <= 0 || documentHeight <= 0) {
    return [0];
  }
  const offsets: number[] = [];
  for (let y = 0; y < documentHeight; y += viewportHeight) {
    offsets.push(y);
  }
  // Always finish back at the bottom so the last content is laid out.
  const lastTop = Math.max(0, documentHeight - viewportHeight);
  if (offsets[offsets.length - 1] !== lastTop) {
    offsets.push(lastTop);
  }
  return offsets;
}

export interface Tile {
  /** Top offset (px) of this tile within the full canvas. */
  top: number;
  /** Height (px) of this tile (the last tile may be shorter). */
  height: number;
}

export interface TilingResult {
  tiles: Tile[];
  /** True when the content exceeded the max-pages cap and was truncated. */
  capped: boolean;
}

/**
 * Slice a canvas of `totalHeight` into tiles of `pageHeight`, up to `maxPages`.
 * The final tile is clamped to the remaining height. If the content needs more
 * than `maxPages` pages it is truncated and `capped` is true (F4 Edge Cases).
 */
export function tilePages(totalHeight: number, pageHeight: number, maxPages: number): TilingResult {
  if (totalHeight <= 0 || pageHeight <= 0 || maxPages <= 0) {
    return { tiles: [], capped: false };
  }
  const neededPages = Math.ceil(totalHeight / pageHeight);
  const pages = Math.min(neededPages, maxPages);
  const tiles: Tile[] = [];
  for (let i = 0; i < pages; i += 1) {
    const top = i * pageHeight;
    const height = Math.min(pageHeight, totalHeight - top);
    tiles.push({ top, height });
  }
  return { tiles, capped: neededPages > maxPages };
}
