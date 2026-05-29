import type { OffscreenHost, OffscreenReason } from '@shared/ports';

interface CreateCall {
  url: string;
  reasons: OffscreenReason[];
  justification: string;
}

/**
 * In-memory fake `OffscreenHost` recording calls and modeling single-instance
 * semantics. `failCreations` makes the next N create() calls throw (to exercise
 * the manager's retry-once policy).
 */
export class FakeOffscreenHost implements OffscreenHost {
  private present = false;
  failCreations = 0;
  readonly createCalls: CreateCall[] = [];
  closeCalls = 0;

  exists(): Promise<boolean> {
    return Promise.resolve(this.present);
  }

  create(url: string, reasons: OffscreenReason[], justification: string): Promise<void> {
    if (this.failCreations > 0) {
      this.failCreations -= 1;
      return Promise.reject(new Error('create rejected'));
    }
    this.createCalls.push({ url, reasons, justification });
    this.present = true;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    this.present = false;
    return Promise.resolve();
  }
}
