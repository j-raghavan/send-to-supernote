import type { CapturePort } from '@shared/ports';

/**
 * Scripted CapturePort (FP3-FR1) — the deterministic test double for the
 * viewport-screenshot seam, mirroring `InMemoryBlobTransfer`'s reference-double
 * style. Returns a fixed window id and canned PNG bytes per `captureViewport`
 * call, and can be told to throw on the next N captures so the orchestrator's
 * retry-once / capture-failed policy (FP3-FR3) is exercisable.
 *
 * Records every captured `windowId` and the resolved `tabId` so tests can assert
 * the `windowIdOf` → `captureViewport(windowId)` wiring.
 */
export class FakeCapturePort implements CapturePort {
  /** windowId returned by `windowIdOf` for any tab. */
  readonly windowId: number;
  /** Tab ids passed to `windowIdOf`, in order. */
  readonly windowIdCalls: number[] = [];
  /** windowIds passed to `captureViewport`, in order. */
  readonly captureCalls: number[] = [];
  /** When > 0, the next `captureViewport` call throws and this decrements. */
  failNext = 0;

  /**
   * @param windowId scripted window id returned by `windowIdOf`
   * @param tileSize byte length of each canned PNG tile
   */
  constructor(
    windowId = 7,
    private readonly tileSize = 8,
  ) {
    this.windowId = windowId;
  }

  windowIdOf(tabId: number): Promise<number> {
    this.windowIdCalls.push(tabId);
    return Promise.resolve(this.windowId);
  }

  captureViewport(windowId: number): Promise<Uint8Array> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      return Promise.reject(new Error('captureVisibleTab failed'));
    }
    this.captureCalls.push(windowId);
    // Canned, per-call-distinct bytes so tests can tell tiles apart.
    const seed = this.captureCalls.length;
    const bytes = new Uint8Array(this.tileSize).map((_v, i) => (seed + i) % 256);
    return Promise.resolve(bytes);
  }
}
