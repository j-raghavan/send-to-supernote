/**
 * Resolve a SendRequest (F6-FR1).
 *
 * The toolbar action sends using the stored defaults (settings.defaultMode +
 * settings.target + defaultFormat + cloudFolderId + confirmFilename); a one-off
 * send from the popup (F6-FR6) overrides mode/format/target. Pure mapping from
 * Settings (+ optional overrides + page context) to a SendRequest the saga runs.
 */
import type { Settings } from '@domain/settings';
import type { CaptureMode, OutputFormat, Target } from '@domain/settings';
import type { PageContext, SendRequest } from './send-document';

export interface SendOverrides {
  mode?: CaptureMode;
  format?: OutputFormat;
  target?: Target;
}

/** Build the default toolbar SendRequest from stored settings (F6-FR1). */
export function resolveSendRequest(
  settings: Settings,
  page: PageContext,
  overrides: SendOverrides = {},
): SendRequest {
  const target = overrides.target ?? settings.target;
  // Full Page is a screenshot — no reflowable text — so it forces PDF here, not
  // only in the UI: a stored defaultFormat='epub' must not leak into a fullpage
  // send (FP1-FR3).
  const mode = overrides.mode ?? settings.defaultMode;
  return {
    mode,
    format: mode === 'fullpage' ? 'pdf' : (overrides.format ?? settings.defaultFormat),
    target,
    ...(target === 'cloud' && settings.cloudFolderId !== undefined
      ? { folderId: settings.cloudFolderId }
      : {}),
    confirmFilename: settings.confirmFilename,
    page,
  };
}
