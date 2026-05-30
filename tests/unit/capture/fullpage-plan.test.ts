import { describe, expect, it } from 'vitest';
import { hasScrollProgress, planScrollOffsets } from '../../../src/capture/fullpage-plan';
import type { PageGeometry } from '../../../src/capture/fullpage-plan';

function geom(totalHeight: number, viewportHeight: number): PageGeometry {
  return { totalHeight, viewportHeight, width: 1280, dpr: 1 };
}

describe('planScrollOffsets (FP2-FR1)', () => {
  it('returns [0] for a page shorter than the viewport', () => {
    expect(planScrollOffsets(geom(600, 800))).toEqual([0]);
  });

  it('returns [0] for a page exactly the viewport height', () => {
    expect(planScrollOffsets(geom(600, 600))).toEqual([0]);
  });

  it('returns [0] when viewportHeight is zero (defensive guard)', () => {
    expect(planScrollOffsets(geom(2000, 0))).toEqual([0]);
  });

  it('returns [0] when viewportHeight is negative (defensive guard)', () => {
    expect(planScrollOffsets(geom(2000, -100))).toEqual([0]);
  });

  it('flush-aligns the last tile with no duplicate for an exact multiple', () => {
    expect(planScrollOffsets(geom(1600, 800))).toEqual([0, 800]);
  });

  it('clamps the final offset for a partial last step', () => {
    expect(planScrollOffsets(geom(2000, 800))).toEqual([0, 800, 1200]);
  });

  it('tiles a taller page top-to-bottom', () => {
    expect(planScrollOffsets(geom(2400, 800))).toEqual([0, 800, 1600]);
  });

  it('produces ascending, gap-free offsets starting at 0 and ending at totalHeight-viewportHeight', () => {
    const cases: Array<[number, number]> = [
      [1600, 800],
      [2000, 800],
      [2400, 800],
      [5000, 700],
      [12345, 911],
    ];
    for (const [totalHeight, viewportHeight] of cases) {
      const offsets = planScrollOffsets(geom(totalHeight, viewportHeight));
      // starts at 0
      expect(offsets[0]).toBe(0);
      // ends at the clamped final offset
      expect(offsets[offsets.length - 1]).toBe(totalHeight - viewportHeight);
      // strictly ascending with no gap larger than the viewport
      for (let i = 1; i < offsets.length; i += 1) {
        const prev = offsets[i - 1] as number;
        const curr = offsets[i] as number;
        const gap = curr - prev;
        expect(gap).toBeGreaterThan(0);
        expect(gap).toBeLessThanOrEqual(viewportHeight);
      }
    }
  });
});

describe('hasScrollProgress (FP2-FR1)', () => {
  it('is true when the document moved', () => {
    expect(hasScrollProgress(0, 800)).toBe(true);
  });

  it('is false when scrollTo did not move the document', () => {
    expect(hasScrollProgress(800, 800)).toBe(false);
  });
});
