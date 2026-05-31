/**
 * Popup view-model (F6-FR6) — covered, pure.
 *
 * Builds the popup's display model from the connection state + settings, and the
 * one-off SendRequest from the user's mode/format/target picks. The popup.ts
 * shell only renders this and wires DOM events; no decisions live in the shell
 * (guard a).
 */
import type { SessionState } from '@domain/auth';
import type { CaptureMode, OutputFormat, Settings, Target } from '@domain/settings';
import { captureModeLabel } from '@capture/copy';
import { resolveSendRequest, type SendOverrides } from '@jobs/resolve-send-request';
import type { PageContext, SendRequest } from '@jobs/send-document';

export interface PopupView {
  /** Whether a send can be started (connected and not expired). */
  canSend: boolean;
  /** Human-readable connection line. */
  status: string;
  /** Pre-selected one-off controls, defaulting to the stored settings. */
  selectedMode: CaptureMode;
  selectedFormat: OutputFormat;
  selectedTarget: Target;
  /** Label for the active mode (e.g. "Reader View"). */
  modeLabel: string;
}

/** Build the popup display model. */
export function buildPopupView(
  session: SessionState,
  account: string | undefined,
  settings: Settings,
): PopupView {
  const status =
    session === 'connected'
      ? account !== undefined
        ? `Connected as ${account}`
        : 'Connected to Supernote Cloud'
      : session === 'expired'
        ? 'Session expired — reconnect in Options'
        : 'Not connected — connect in Options';
  return {
    canSend: session === 'connected',
    status,
    selectedMode: settings.defaultMode,
    selectedFormat: settings.defaultFormat,
    selectedTarget: settings.target,
    modeLabel: captureModeLabel(settings.defaultMode),
  };
}

/** A connect attempt's outcome as the SW reports it (network vs login failure). */
export interface ConnectFailure {
  /** The SW's classification; `network` means the request never reached a login endpoint. */
  kind?: string;
  /** The SW-provided message (already actionable for `network`). */
  error?: string;
}

/**
 * Primary copy for a FAILED Private Cloud connect. ONLY a genuine login
 * rejection (`kind: 'auth'`) gets the "Could not sign in:" framing. A `network`
 * failure (never reached a login endpoint) carries its own actionable
 * reachability/cert hint, and an infrastructure failure (e.g. the SW didn't
 * respond — no `kind`) is already a standalone message; both are shown as-is, so
 * a missing/unknown `kind` can never mis-frame a "couldn't reach…" hint as a
 * sign-in failure.
 */
export function connectFailureMessage(result: ConnectFailure): string {
  if (result.kind === 'auth') {
    return `Could not sign in: ${result.error ?? 'unknown error'}`;
  }
  return result.error ?? "Couldn't reach your Private Cloud server.";
}

/** Build a one-off SendRequest from the popup's current control selections. */
export function popupSendRequest(
  settings: Settings,
  page: PageContext,
  overrides: SendOverrides,
): SendRequest {
  return resolveSendRequest(settings, page, overrides);
}
