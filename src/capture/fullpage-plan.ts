/**
 * Full Page scroll planning (FP2-FR1) — pure arithmetic, no DOM, no chrome.
 *
 * The background drives a scroll loop, capturing one viewport-height tile per
 * step. This module computes the ordered scroll Y offsets that tile a page
 * top-to-bottom with no gap and a clamped final step, and detects when a
 * scroll did not actually move the document (SPA/inner-scroll → single tile).
 * The DOM measurement (scrollHeight/innerHeight/dpr) lives in the injected
 * executeScript fn; the math is extracted here so it is unit-testable (FP2-AC1).
 */

/** Page measurements taken in the content world before planning the scroll. */
export interface PageGeometry {
  totalHeight: number; // document scrollHeight (CSS px)
  viewportHeight: number; // innerHeight / clientHeight
  width: number; // viewport width
  dpr: number; // devicePixelRatio
}

/**
 * Ordered scroll Y offsets covering `[0 .. totalHeight]` in viewport-height
 * steps, with a clamped final step (`totalHeight - viewportHeight`) and no
 * duplicate last offset. A page shorter than (or equal to) the viewport — or a
 * defensively-invalid `viewportHeight <= 0` — yields exactly `[0]` (one tile).
 */
export function planScrollOffsets(g: PageGeometry): number[] {
  const { totalHeight, viewportHeight } = g;
  // Defensive guard + short page: a single viewport covers everything.
  if (viewportHeight <= 0 || totalHeight <= viewportHeight) {
    return [0];
  }

  const lastOffset = totalHeight - viewportHeight;
  const offsets: number[] = [];
  // Steps strictly below lastOffset, so the loop never lands on it…
  for (let y = 0; y < lastOffset; y += viewportHeight) {
    offsets.push(y);
  }
  // …then the clamped final offset covers the bottom band. No duplicate is
  // possible (the loop stopped short of lastOffset), so this append is
  // unconditional — exact-multiple pages just get a flush-aligned last tile.
  offsets.push(lastOffset);
  return offsets;
}

/**
 * False when `scrollTo` did not move the document (the new Y equals the
 * previous Y), signalling an SPA / inner-scroll page that should fall back to a
 * single-tile capture (FP6-FR3) rather than looping forever.
 */
export function hasScrollProgress(prevY: number, newY: number): boolean {
  return newY !== prevY;
}
