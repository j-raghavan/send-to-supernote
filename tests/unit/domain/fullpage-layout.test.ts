import { describe, expect, it } from 'vitest';
import { scrollPlan, tilePages } from '@domain/fullpage-layout';

describe('scrollPlan (F4-FR3 scroll-trigger)', () => {
  it('steps by viewport height and finishes at the bottom', () => {
    expect(scrollPlan(2000, 800)).toEqual([0, 800, 1600, 1200]);
  });

  it('returns a single step for a page that fits the viewport', () => {
    expect(scrollPlan(600, 800)).toEqual([0]);
  });

  it('does not duplicate the bottom step when it lands exactly', () => {
    expect(scrollPlan(1600, 800)).toEqual([0, 800]);
  });

  it('returns [0] for degenerate dimensions', () => {
    expect(scrollPlan(0, 800)).toEqual([0]);
    expect(scrollPlan(2000, 0)).toEqual([0]);
  });
});

describe('tilePages (F4-FR3 tiling / Edge Cases cap)', () => {
  it('slices a tall canvas into full + remainder tiles', () => {
    const { tiles, capped } = tilePages(2500, 1000, 10);
    expect(capped).toBe(false);
    expect(tiles).toEqual([
      { top: 0, height: 1000 },
      { top: 1000, height: 1000 },
      { top: 2000, height: 500 },
    ]);
  });

  it('produces a single tile when content fits one page', () => {
    expect(tilePages(800, 1000, 10).tiles).toEqual([{ top: 0, height: 800 }]);
  });

  it('caps at maxPages and flags capped (extremely long page)', () => {
    const { tiles, capped } = tilePages(100000, 1000, 3);
    expect(tiles).toHaveLength(3);
    expect(capped).toBe(true);
  });

  it('returns no tiles for degenerate inputs', () => {
    expect(tilePages(0, 1000, 5)).toEqual({ tiles: [], capped: false });
    expect(tilePages(1000, 0, 5)).toEqual({ tiles: [], capped: false });
    expect(tilePages(1000, 1000, 0)).toEqual({ tiles: [], capped: false });
  });

  it('does not flag capped when the needed pages equal the cap exactly', () => {
    expect(tilePages(3000, 1000, 3).capped).toBe(false);
  });
});
