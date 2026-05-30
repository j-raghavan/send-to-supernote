/**
 * planFullPage (FP4-FR1/FR3 + FP6-FR1) — PURE geometry planner, no DOM.
 *
 * Runs in the default `node` environment. Every branch (dpr guard, height-cap
 * vs page-cap truncation, multi/single band, multi/single page-slice with
 * remainder, zero/tiny guard, a4 vs letter) is reachable from the numeric
 * arguments alone, so the planner is covered to 100% here. Expected values are
 * computed BY HAND in the comments and asserted exactly.
 *
 * Page-band height is now WIDTH-PROPORTIONAL (`round(width·dpr · pageAspect)`),
 * not a fixed 300-dpi basis — the legibility fix. A4 aspect = 297/210 ≈ 1.414…,
 * Letter = 11/8.5 ≈ 1.294…. So at the default `width: 800, dpr: 1` an a4 page
 * band is `round(800 · 1.41428…) = 1131` px and a letter band `round(800 ·
 * 1.29411…) = 1035` px.
 */
import { describe, expect, it } from 'vitest';
import {
  CANVAS_MAX_PX,
  DEFAULT_CAP,
  planFullPage,
  type StitchGeometry,
} from '@conversion/fullpage-stitch-core';

/** Build a StitchGeometry; only the planner-relevant fields matter here. */
function geom(over: Partial<StitchGeometry>): StitchGeometry {
  return {
    totalHeight: 1000,
    viewportHeight: 600,
    width: 800,
    dpr: 1,
    pageSize: 'a4',
    ...over,
  };
}

/** Assert contiguous, gap-free `{ start, height }` bands/slices covering [0,total). */
function expectGapFree<T extends { height: number }>(
  parts: T[],
  startOf: (p: T) => number,
  total: number,
  maxHeight = Infinity,
): void {
  expect(parts.length).toBeGreaterThanOrEqual(1);
  let cursor = 0;
  for (const p of parts) {
    expect(startOf(p)).toBe(cursor); // contiguous, no gap/overlap
    expect(p.height).toBeGreaterThan(0);
    expect(p.height).toBeLessThanOrEqual(maxHeight);
    cursor += p.height;
  }
  expect(cursor).toBe(total); // exactly covers [0, total)
}

const bandsCover = (bands: { startY: number; height: number }[], total: number): void =>
  expectGapFree(bands, (b) => b.startY, total, CANVAS_MAX_PX);
const slicesCover = (slices: { sourceY: number; height: number }[], total: number): void =>
  expectGapFree(slices, (s) => s.sourceY, total);

describe('planFullPage — constants', () => {
  it('exposes the conservative cross-browser canvas max (FP4-FR3)', () => {
    expect(CANVAS_MAX_PX).toBe(16384);
  });

  it('default cap is 50 pages with a 50·3508 px absolute height guard', () => {
    expect(DEFAULT_CAP).toEqual({ maxPages: 50, maxHeightPx: 50 * 3508 });
  });
});

describe('planFullPage — width-proportional page height (the legibility fix)', () => {
  it('scales the page-band height with the capture width, not a fixed basis', () => {
    // width 400 → a4 band round(400·1.41428…)=566; width 1600 → round(1600·…)=2263.
    // Both pages are taller than one band, so the FIRST slice height == the band.
    const narrow = planFullPage(geom({ width: 400, totalHeight: 10000 }));
    const wide = planFullPage(geom({ width: 1600, totalHeight: 10000 }));
    expect(narrow.pageSlices[0]!.height).toBe(566);
    expect(wide.pageSlices[0]!.height).toBe(2263);
    // ~4× the width → ~4× the band height (proportional, no fixed 3508 basis).
    expect(wide.pageSlices[0]!.height / narrow.pageSlices[0]!.height).toBeCloseTo(4, 0);
  });

  it('guards a zero/negative width to a 1-px-wide basis without throwing', () => {
    // width 0 → widthDevicePx max(1,round(0))=1 → band round(1·1.41428…)=1.
    const plan = planFullPage(geom({ width: 0, totalHeight: 10 }));
    expect(plan.totalDeviceHeight).toBe(10);
    slicesCover(plan.pageSlices, 10);
    expect(plan.pageSlices.every((s) => s.height === 1)).toBe(true);
  });
});

describe('planFullPage — dpr guard', () => {
  it('treats dpr <= 0 as 1 (single band/slice, not truncated)', () => {
    // dpr=0 → 1. width 800 → band 1131, raw=1000 < heightCap → totalDeviceHeight=1000.
    const plan = planFullPage(geom({ totalHeight: 1000, dpr: 0 }));
    expect(plan.totalDeviceHeight).toBe(1000);
    expect(plan.truncated).toBe(false);
    expect(plan.bands).toEqual([{ startY: 0, height: 1000 }]);
    expect(plan.pageSlices).toEqual([{ sourceY: 0, height: 1000 }]);
    bandsCover(plan.bands, 1000);
  });

  it('treats a negative dpr as 1 as well', () => {
    const plan = planFullPage(geom({ totalHeight: 500, dpr: -3 }));
    expect(plan.totalDeviceHeight).toBe(500); // 500 * 1
  });

  it('scales by dpr when dpr > 0 (raw device height = totalHeight * dpr)', () => {
    // dpr=2 → widthDevicePx=1600, band round(1600·1.41428…)=2263, raw=2000.
    const plan = planFullPage(geom({ totalHeight: 1000, dpr: 2 }));
    expect(plan.totalDeviceHeight).toBe(2000);
    expect(plan.truncated).toBe(false);
    expect(plan.bands).toEqual([{ startY: 0, height: 2000 }]);
    expect(plan.pageSlices).toEqual([{ sourceY: 0, height: 2000 }]); // 2000 < band(2263)
  });
});

describe('planFullPage — truncation caps (FP6-FR1)', () => {
  it('truncates by the HEIGHT cap when maxHeightPx is the smaller bound', () => {
    // a4 width 800 dpr 1: band=1131, pageCapHeight=100·1131=113100,
    // heightCap=min(5000, 113100)=5000 (height cap binds). raw=10000 > 5000.
    const plan = planFullPage(geom({ totalHeight: 10000, dpr: 1 }), {
      maxPages: 100,
      maxHeightPx: 5000,
    });
    expect(plan.truncated).toBe(true);
    expect(plan.totalDeviceHeight).toBe(5000);
    expect(plan.bands).toEqual([{ startY: 0, height: 5000 }]); // tile(5000, 16384)
    // pageSlices: tile(5000, 1131) → four full bands + remainder 476.
    expect(plan.pageSlices).toEqual([
      { sourceY: 0, height: 1131 },
      { sourceY: 1131, height: 1131 },
      { sourceY: 2262, height: 1131 },
      { sourceY: 3393, height: 1131 },
      { sourceY: 4524, height: 476 },
    ]);
    bandsCover(plan.bands, 5000);
    slicesCover(plan.pageSlices, 5000);
  });

  it('truncates by the PAGE-COUNT cap when maxPages · band is smaller', () => {
    // band=1131, pageCapHeight=1·1131=1131, heightCap=min(999999,1131)=1131.
    const plan = planFullPage(geom({ totalHeight: 10000, dpr: 1 }), {
      maxPages: 1,
      maxHeightPx: 999999,
    });
    expect(plan.truncated).toBe(true);
    expect(plan.totalDeviceHeight).toBe(1131);
    expect(plan.bands).toEqual([{ startY: 0, height: 1131 }]);
    expect(plan.pageSlices).toEqual([{ sourceY: 0, height: 1131 }]); // the one allowed page
  });

  it('is NOT truncated when the raw device height fits the cap', () => {
    const plan = planFullPage(geom({ totalHeight: 1000, dpr: 1 }));
    expect(plan.truncated).toBe(false);
    expect(plan.totalDeviceHeight).toBe(1000);
  });
});

describe('planFullPage — banding (FP4-FR3, each band ≤ 16384)', () => {
  it('multi-band when totalDeviceHeight > CANVAS_MAX_PX, last band is the remainder', () => {
    // width 800 dpr 2: band=2263, pageCapHeight=50·2263=113150,
    // heightCap=min(175400,113150)=113150 → raw=40000 fits, totalDeviceHeight=40000.
    const plan = planFullPage(geom({ totalHeight: 20000, dpr: 2 }));
    expect(plan.truncated).toBe(false);
    expect(plan.totalDeviceHeight).toBe(40000);
    // tile(40000, 16384) → [0,16384],[16384,16384],[32768, 7232].
    expect(plan.bands).toEqual([
      { startY: 0, height: 16384 },
      { startY: 16384, height: 16384 },
      { startY: 32768, height: 7232 },
    ]);
    bandsCover(plan.bands, 40000);
    // pageSlices: tile(40000, 2263) → ceil(40000/2263)=18 slices, gap-free.
    expect(plan.pageSlices).toHaveLength(18);
    expect(plan.pageSlices.at(-1)).toEqual({ sourceY: 38471, height: 1529 });
    slicesCover(plan.pageSlices, 40000);
  });

  it('single band when totalDeviceHeight ≤ CANVAS_MAX_PX', () => {
    const plan = planFullPage(geom({ totalHeight: 10000, dpr: 1 }));
    expect(plan.totalDeviceHeight).toBe(10000);
    expect(plan.bands).toEqual([{ startY: 0, height: 10000 }]);
  });

  it('produces an exact-multiple band boundary with no zero remainder', () => {
    // totalHeight=32768, dpr=1 → exactly 2 full bands (16384 * 2), no remainder.
    const plan = planFullPage(geom({ totalHeight: 32768, dpr: 1 }));
    expect(plan.bands).toEqual([
      { startY: 0, height: 16384 },
      { startY: 16384, height: 16384 },
    ]);
    bandsCover(plan.bands, 32768);
  });
});

describe('planFullPage — page slices (FP5)', () => {
  it('single slice when the page is shorter than one page-height', () => {
    const plan = planFullPage(geom({ totalHeight: 1000, dpr: 1 }));
    expect(plan.pageSlices).toEqual([{ sourceY: 0, height: 1000 }]); // 1000 < band(1131)
  });

  it('multi-slice with a remainder slice (a4)', () => {
    // a4 width 800 dpr 1: band=1131, raw=5000 → tile(5000, 1131).
    const plan = planFullPage(geom({ totalHeight: 5000, dpr: 1 }));
    expect(plan.pageSlices).toEqual([
      { sourceY: 0, height: 1131 },
      { sourceY: 1131, height: 1131 },
      { sourceY: 2262, height: 1131 },
      { sourceY: 3393, height: 1131 },
      { sourceY: 4524, height: 476 },
    ]);
    slicesCover(plan.pageSlices, 5000);
  });
});

describe('planFullPage — pageSize variants', () => {
  it('uses width × A4 aspect (1.414…) for the a4 page band', () => {
    // a4 width 800 dpr 1: band=1131; totalHeight=2262 → exactly 2 full slices.
    const plan = planFullPage(geom({ totalHeight: 2262, dpr: 1, pageSize: 'a4' }));
    expect(plan.pageSlices).toEqual([
      { sourceY: 0, height: 1131 },
      { sourceY: 1131, height: 1131 },
    ]);
  });

  it('uses width × Letter aspect (1.294…) for the letter page band', () => {
    // letter width 800 dpr 1: band=round(800·1.29411…)=1035; totalHeight=2070 → 2 slices.
    const plan = planFullPage(geom({ totalHeight: 2070, dpr: 1, pageSize: 'letter' }));
    expect(plan.pageSlices).toEqual([
      { sourceY: 0, height: 1035 },
      { sourceY: 1035, height: 1035 },
    ]);
    expect(plan.totalDeviceHeight).toBe(2070);
  });
});

describe('planFullPage — zero/tiny guard', () => {
  it('clamps zero totalHeight to a single 1-px band and slice', () => {
    const plan = planFullPage(geom({ totalHeight: 0, dpr: 1 }));
    expect(plan.totalDeviceHeight).toBe(1);
    expect(plan.truncated).toBe(false);
    expect(plan.bands).toEqual([{ startY: 0, height: 1 }]);
    expect(plan.pageSlices).toEqual([{ sourceY: 0, height: 1 }]);
    bandsCover(plan.bands, 1);
  });

  it('clamps a negative totalHeight to a single 1-px band/slice', () => {
    // raw = max(0, -500) * 1 = 0 → guarded to 1.
    const plan = planFullPage(geom({ totalHeight: -500, dpr: 1 }));
    expect(plan.totalDeviceHeight).toBe(1);
    expect(plan.bands).toEqual([{ startY: 0, height: 1 }]);
    expect(plan.pageSlices).toEqual([{ sourceY: 0, height: 1 }]);
  });

  it('rounds a sub-pixel raw device height to one band/slice', () => {
    // totalHeight=0.3, dpr=1 → raw=0.3, round(min(0.3,cap))=0 → guarded to 1.
    const plan = planFullPage(geom({ totalHeight: 0.3, dpr: 1 }));
    expect(plan.totalDeviceHeight).toBe(1);
  });
});

describe('planFullPage — default cap', () => {
  it('applies DEFAULT_CAP (50 pages) when no cap argument is given', () => {
    // width 800 → band 1131, pageCapHeight=50·1131=56550, heightCap=min(175400,56550)=56550.
    // raw=200000 > 56550 → truncated at the page-count cap.
    const plan = planFullPage(geom({ totalHeight: 200000, dpr: 1 }));
    expect(plan.truncated).toBe(true);
    expect(plan.totalDeviceHeight).toBe(56550);
    expect(plan.pageSlices).toHaveLength(50);
  });

  it('lets the absolute maxHeightPx guard bind for an unusually wide capture', () => {
    // width 3000 dpr 1: band=round(3000·1.41428…)=4243, pageCapHeight=50·4243=212150,
    // heightCap=min(175400, 212150)=175400 (absolute guard binds, < 50 pages).
    const plan = planFullPage(geom({ totalHeight: 500000, dpr: 1, width: 3000 }));
    expect(plan.truncated).toBe(true);
    expect(plan.totalDeviceHeight).toBe(175400);
    expect(plan.pageSlices.length).toBeLessThan(50);
  });
});
