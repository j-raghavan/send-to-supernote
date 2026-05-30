/**
 * planFullPage (FP4-FR1/FR3 + FP6-FR1) — PURE geometry planner, no DOM.
 *
 * Runs in the default `node` environment. Every branch (dpr guard, height-cap
 * vs page-cap truncation, multi/single band, multi/single page-slice with
 * remainder, zero/tiny guard, a4 vs letter) is reachable from the numeric
 * arguments alone, so the planner is covered to 100% here. Expected values are
 * computed BY HAND in the comments and asserted exactly.
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

/** Assert bands tile [0, total) gap-free, each ≤ CANVAS_MAX_PX. */
function expectGapFreeBands(bands: { startY: number; height: number }[], total: number): void {
  expect(bands.length).toBeGreaterThanOrEqual(1);
  let cursor = 0;
  for (const b of bands) {
    expect(b.startY).toBe(cursor); // contiguous, no gap/overlap
    expect(b.height).toBeGreaterThan(0);
    expect(b.height).toBeLessThanOrEqual(CANVAS_MAX_PX);
    cursor += b.height;
  }
  expect(cursor).toBe(total); // exactly covers [0, total)
}

describe('planFullPage — constants', () => {
  it('exposes the conservative cross-browser canvas max (FP4-FR3)', () => {
    expect(CANVAS_MAX_PX).toBe(16384);
  });

  it('default cap is 50 A4 pages on the 300-dpi basis', () => {
    expect(DEFAULT_CAP).toEqual({ maxPages: 50, maxHeightPx: 50 * 3508 });
  });
});

describe('planFullPage — dpr guard', () => {
  it('treats dpr <= 0 as 1 (small a4 page, single band/slice, not truncated)', () => {
    // dpr=0 → 1. pageHeightPx=3508, raw=1000, heightCap=min(175400,175400)=175400.
    const plan = planFullPage(geom({ totalHeight: 1000, dpr: 0 }));
    expect(plan.totalDeviceHeight).toBe(1000);
    expect(plan.truncated).toBe(false);
    expect(plan.bands).toEqual([{ startY: 0, height: 1000 }]);
    expect(plan.pageSlices).toEqual([{ sourceY: 0, height: 1000 }]);
    expectGapFreeBands(plan.bands, 1000);
  });

  it('treats a negative dpr as 1 as well', () => {
    const plan = planFullPage(geom({ totalHeight: 500, dpr: -3 }));
    expect(plan.totalDeviceHeight).toBe(500); // 500 * 1
  });

  it('scales by dpr when dpr > 0 (raw device height = totalHeight * dpr)', () => {
    // dpr=2 → raw=2000, pageHeightPx=7016, heightCap=min(175400,350800)=175400.
    const plan = planFullPage(geom({ totalHeight: 1000, dpr: 2 }));
    expect(plan.totalDeviceHeight).toBe(2000);
    expect(plan.truncated).toBe(false);
    expect(plan.bands).toEqual([{ startY: 0, height: 2000 }]);
    expect(plan.pageSlices).toEqual([{ sourceY: 0, height: 2000 }]);
  });
});

describe('planFullPage — truncation caps (FP6-FR1)', () => {
  it('truncates by the HEIGHT cap when maxHeightPx is the smaller bound', () => {
    // a4 dpr=1: pageHeightPx=3508, pageCapHeight=100*3508=350800,
    // heightCap=min(5000, 350800)=5000 (height cap binds). raw=10000 > 5000.
    const plan = planFullPage(geom({ totalHeight: 10000, dpr: 1 }), {
      maxPages: 100,
      maxHeightPx: 5000,
    });
    expect(plan.truncated).toBe(true);
    expect(plan.totalDeviceHeight).toBe(5000);
    // bands: tile(5000, 16384) → single band.
    expect(plan.bands).toEqual([{ startY: 0, height: 5000 }]);
    // pageSlices: tile(5000, 3508) → [0,3508],[3508, 1492].
    expect(plan.pageSlices).toEqual([
      { sourceY: 0, height: 3508 },
      { sourceY: 3508, height: 1492 },
    ]);
    expectGapFreeBands(plan.bands, 5000);
  });

  it('truncates by the PAGE-COUNT cap when maxPages * pageHeightPx is smaller', () => {
    // a4 dpr=1: pageHeightPx=3508, pageCapHeight=1*3508=3508,
    // heightCap=min(999999, 3508)=3508 (page cap binds). raw=10000 > 3508.
    const plan = planFullPage(geom({ totalHeight: 10000, dpr: 1 }), {
      maxPages: 1,
      maxHeightPx: 999999,
    });
    expect(plan.truncated).toBe(true);
    expect(plan.totalDeviceHeight).toBe(3508);
    expect(plan.bands).toEqual([{ startY: 0, height: 3508 }]);
    // Exactly one page slice (the single allowed page).
    expect(plan.pageSlices).toEqual([{ sourceY: 0, height: 3508 }]);
  });

  it('is NOT truncated when the raw device height fits the cap', () => {
    const plan = planFullPage(geom({ totalHeight: 1000, dpr: 1 }));
    expect(plan.truncated).toBe(false);
    expect(plan.totalDeviceHeight).toBe(1000);
  });
});

describe('planFullPage — banding (FP4-FR3, each band ≤ 16384)', () => {
  it('multi-band when totalDeviceHeight > CANVAS_MAX_PX, last band is the remainder', () => {
    // a4 dpr=2: pageHeightPx=7016, raw=40000, pageCapHeight=350800,
    // heightCap=175400 → not truncated, totalDeviceHeight=40000.
    const plan = planFullPage(geom({ totalHeight: 20000, dpr: 2 }));
    expect(plan.truncated).toBe(false);
    expect(plan.totalDeviceHeight).toBe(40000);
    // tile(40000, 16384) → [0,16384],[16384,16384],[32768, 7232].
    expect(plan.bands).toEqual([
      { startY: 0, height: 16384 },
      { startY: 16384, height: 16384 },
      { startY: 32768, height: 7232 },
    ]);
    expectGapFreeBands(plan.bands, 40000);
    // pageSlices: tile(40000, 7016) → 6 slices, last remainder 4920.
    expect(plan.pageSlices).toEqual([
      { sourceY: 0, height: 7016 },
      { sourceY: 7016, height: 7016 },
      { sourceY: 14032, height: 7016 },
      { sourceY: 21048, height: 7016 },
      { sourceY: 28064, height: 7016 },
      { sourceY: 35080, height: 4920 },
    ]);
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
    expectGapFreeBands(plan.bands, 32768);
  });
});

describe('planFullPage — page slices (FP5)', () => {
  it('single slice when the page is shorter than one page-height', () => {
    const plan = planFullPage(geom({ totalHeight: 1000, dpr: 1 }));
    expect(plan.pageSlices).toEqual([{ sourceY: 0, height: 1000 }]);
  });

  it('multi-slice with a remainder slice (a4)', () => {
    // a4 dpr=1: pageHeightPx=3508, raw=5000.
    const plan = planFullPage(geom({ totalHeight: 5000, dpr: 1 }));
    // tile(5000, 3508) → [0,3508],[3508, 1492].
    expect(plan.pageSlices).toEqual([
      { sourceY: 0, height: 3508 },
      { sourceY: 3508, height: 1492 },
    ]);
  });
});

describe('planFullPage — pageSize variants', () => {
  it('uses 3508 px page-height for a4', () => {
    // a4 dpr=1, totalHeight=7016 → exactly 2 full slices.
    const plan = planFullPage(geom({ totalHeight: 7016, dpr: 1, pageSize: 'a4' }));
    expect(plan.pageSlices).toEqual([
      { sourceY: 0, height: 3508 },
      { sourceY: 3508, height: 3508 },
    ]);
  });

  it('uses 3300 px page-height for letter', () => {
    // letter dpr=1: pageHeightPx=3300, raw=5000.
    const plan = planFullPage(geom({ totalHeight: 5000, dpr: 1, pageSize: 'letter' }));
    // tile(5000, 3300) → [0,3300],[3300, 1700].
    expect(plan.pageSlices).toEqual([
      { sourceY: 0, height: 3300 },
      { sourceY: 3300, height: 1700 },
    ]);
    expect(plan.totalDeviceHeight).toBe(5000);
  });
});

describe('planFullPage — zero/tiny guard', () => {
  it('clamps zero totalHeight to a single 1-px band and slice', () => {
    const plan = planFullPage(geom({ totalHeight: 0, dpr: 1 }));
    expect(plan.totalDeviceHeight).toBe(1);
    expect(plan.truncated).toBe(false);
    expect(plan.bands).toEqual([{ startY: 0, height: 1 }]);
    expect(plan.pageSlices).toEqual([{ sourceY: 0, height: 1 }]);
    expectGapFreeBands(plan.bands, 1);
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
  it('applies DEFAULT_CAP when no cap argument is given', () => {
    // raw=200000 > 175400 → truncated at the default height cap.
    const plan = planFullPage(geom({ totalHeight: 200000, dpr: 1 }));
    expect(plan.truncated).toBe(true);
    expect(plan.totalDeviceHeight).toBe(175400);
  });
});
