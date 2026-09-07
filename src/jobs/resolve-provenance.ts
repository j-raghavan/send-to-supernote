/**
 * Provenance resolution for a send (CP3) — pure.
 *
 * Decides whether a send is stamped with "where + when" and builds the value the
 * render cores consume. Stamped only for a capture->render send with the opt-in
 * toggle on AND a known page URL (an older caller that supplies only a hostname
 * gets no stamp — `PageContext.url`); never for a pre-rendered `source`
 * pass-through (there is no render seam to inject into — Non-Goal). The instant
 * and zone come from the caller (the saga's injected Clock) so this stays
 * deterministic and port-pure.
 */
import type { Provenance } from '@domain/conversion';

export interface ProvenanceRequest {
  includeProvenance: boolean;
  page: { url?: string };
  /** Present for a pre-rendered pass-through, which is never stamped. */
  source?: unknown;
}

/** The provenance to stamp, or undefined when the toggle is off / not applicable. */
export function resolveProvenance(
  req: ProvenanceRequest,
  capturedAtMs: number,
  timeZone: string | undefined,
): Provenance | undefined {
  if (!req.includeProvenance || req.source !== undefined || req.page.url === undefined) {
    return undefined;
  }
  return {
    sourceUrl: req.page.url.trim(),
    capturedAtMs,
    ...(timeZone !== undefined ? { timeZone } : {}),
  };
}
