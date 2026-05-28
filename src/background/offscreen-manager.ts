/**
 * Offscreen document lifecycle manager (F1-FR5, ADR-0005).
 *
 * Enforces the MV3 single-instance rule (only one offscreen document may exist;
 * reuse-or-create, never create a second), creates-before-render with explicit
 * declared `reasons`, and closes-after. Create failure is retried once; a second
 * failure surfaces an error so the saga can fail the job (spec Edge Cases:
 * "Offscreen document creation fails / closed early. Retry once.").
 *
 * The branching/policy lives here (testable against a fake `OffscreenHost`); the
 * raw `chrome.offscreen` calls live in the thin adapter that implements the port.
 */
import type { OffscreenHost, OffscreenReason } from '@shared/ports';
import { err, ok, type Result } from '@shared/result';

export const OFFSCREEN_URL = 'src/offscreen/offscreen.html';

/** Reasons used by the rendering offscreen document (F3/F4 conversion). */
export const OFFSCREEN_REASONS: OffscreenReason[] = ['DOM_PARSER', 'BLOBS'];

export const OFFSCREEN_JUSTIFICATION =
  'Render captured page HTML to a PDF/EPUB blob (no DOM in the service worker).';

export type OffscreenError = 'create-failed';

export class OffscreenManager {
  constructor(private readonly host: OffscreenHost) {}

  /**
   * Ensure exactly one offscreen document exists. If one is already present it
   * is reused (never a second); otherwise it is created with declared reasons.
   * Retries a failed creation once before giving up.
   */
  async ensure(): Promise<Result<void, OffscreenError>> {
    if (await this.host.exists()) {
      return ok(undefined);
    }
    const created = await this.tryCreate();
    if (created) {
      return ok(undefined);
    }
    // Retry once (Edge Cases).
    if (await this.tryCreate()) {
      return ok(undefined);
    }
    return err('create-failed');
  }

  /** Close the offscreen document after rendering, if one exists. */
  async release(): Promise<void> {
    if (await this.host.exists()) {
      await this.host.close();
    }
  }

  private async tryCreate(): Promise<boolean> {
    try {
      await this.host.create(OFFSCREEN_URL, OFFSCREEN_REASONS, OFFSCREEN_JUSTIFICATION);
      return true;
    } catch {
      return false;
    }
  }
}
