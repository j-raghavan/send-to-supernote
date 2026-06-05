/**
 * Options view-model (F7-FR1) — covered, pure.
 *
 * Builds the Options page display state from the current settings + connection
 * state, and validates incoming control values before they are persisted via the
 * SettingsStore. The options.ts shell only renders this and wires DOM events; no
 * decisions live in the shell (guard a).
 */
import type { SessionState } from '@domain/auth';
import {
  isCaptureMode,
  isOutputFormat,
  isTarget,
  type CaptureMode,
  type OutputFormat,
  type Settings,
  type Target,
} from '@domain/settings';
import { allowedFormats, coerceFormat } from '@domain/capture-format';

export interface OptionsView {
  /** Connection panel line (delegates to F2 state). */
  connectionStatus: string;
  connected: boolean;
  account?: string;
  /** Currently-selected capture defaults + target + toggle. */
  defaultMode: CaptureMode;
  defaultFormat: OutputFormat;
  target: Target;
  confirmFilename: boolean;
  /** Whether the public Cloud folder picker can be shown (connected to cloud). */
  canPickCloudFolder: boolean;
  /** Which format <option>s are enabled for the current default mode. */
  formatEnabled: Record<OutputFormat, boolean>;
}

/** Build the Options display model. */
export function buildOptionsView(
  session: SessionState,
  account: string | undefined,
  settings: Settings,
): OptionsView {
  const connected = session === 'connected';
  const connectionStatus = connected
    ? account !== undefined
      ? `Connected as ${account}`
      : 'Connected to Supernote Cloud'
    : session === 'expired'
      ? 'Session expired — reconnect'
      : 'Not connected';
  const allowed = allowedFormats(settings.defaultMode);
  const formatEnabled: Record<OutputFormat, boolean> = {
    pdf: allowed.includes('pdf'),
    epub: allowed.includes('epub'),
  };
  return {
    connectionStatus,
    connected,
    ...(account !== undefined ? { account } : {}),
    defaultMode: settings.defaultMode,
    defaultFormat: coerceFormat(settings.defaultMode, settings.defaultFormat),
    target: settings.target,
    confirmFilename: settings.confirmFilename,
    canPickCloudFolder: connected && settings.target === 'cloud',
    formatEnabled,
  };
}

/**
 * Whether the Private Cloud folder picker can be shown: connected to a Private
 * Cloud server AND it is the active target. Mirrors `canPickCloudFolder` for the
 * private panel (the picker lists the user's OWN server's folders).
 */
export function canPickPrivateFolder(privateSession: SessionState, target: Target): boolean {
  return privateSession === 'connected' && target === 'privatecloud';
}

/** Validate a control value as a CaptureMode before persisting (F7-FR1). */
export function parseModeChange(value: string): CaptureMode | undefined {
  return isCaptureMode(value) ? value : undefined;
}

export function parseFormatChange(value: string): OutputFormat | undefined {
  return isOutputFormat(value) ? value : undefined;
}

export function parseTargetChange(value: string): Target | undefined {
  return isTarget(value) ? value : undefined;
}

/**
 * Re-derive the format select state when the capture mode changes: coerce the
 * current format to one the new mode allows and recompute which options enable.
 * The options.ts shell calls this on mode-change and only renders the result.
 */
export function coerceFormatForMode(
  mode: CaptureMode,
  currentFormat: OutputFormat,
): { value: OutputFormat; formatEnabled: Record<OutputFormat, boolean> } {
  const allowed = allowedFormats(mode);
  return {
    value: coerceFormat(mode, currentFormat),
    formatEnabled: { pdf: allowed.includes('pdf'), epub: allowed.includes('epub') },
  };
}
