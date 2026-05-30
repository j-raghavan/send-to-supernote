import type { FullPageDriver } from '@capture/capture-fullpage';
import type { StitchGeometry } from '@conversion/fullpage-stitch-core';

/**
 * Scripted FullPageDriver (FP2-FR3/FR4, FP6-FR3) — the deterministic test double
 * for the platform side of one capture run. `measure()` returns a scripted
 * geometry (so `planScrollOffsets` yields a known offset count); `scrollTo(y)`
 * returns a scripted "actual" scrollY so the non-scroll fallback (real movement
 * vs a stuck SPA constant) is exercisable; `dispose()` records its call count so
 * the restore-always invariant (FP2-FR4 / IP-1) can be asserted on every exit
 * path.
 */
export class FakeFullPageDriver implements FullPageDriver {
  /** Ys passed to `scrollTo`, in order. */
  readonly scrollToCalls: number[] = [];
  /** Number of times `dispose` was called (must be exactly 1 on every path). */
  disposeCalls = 0;

  /**
   * @param geometry scripted page geometry returned by `measure`
   * @param scrollResult maps a requested y → the document's "actual" scrollY
   *   after scrolling. Defaults to identity (the page always moves as asked).
   */
  constructor(
    private readonly geometry: StitchGeometry,
    private readonly scrollResult: (y: number) => number = (y) => y,
  ) {}

  measure(): Promise<StitchGeometry> {
    return Promise.resolve(this.geometry);
  }

  scrollTo(y: number): Promise<number> {
    this.scrollToCalls.push(y);
    return Promise.resolve(this.scrollResult(y));
  }

  dispose(): Promise<void> {
    this.disposeCalls += 1;
    return Promise.resolve();
  }
}
