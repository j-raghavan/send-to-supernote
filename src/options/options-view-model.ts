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
}

/** Build the Options display model. */
export function buildOptionsView(
  session: SessionState,
  account: string | undefined,
  settings: Settings,
): OptionsView {
  const connected = session === 'connected';
  const connectionStatus =
    connected && account !== undefined
      ? `Connected as ${account}`
      : session === 'expired'
        ? 'Session expired — reconnect'
        : 'Not connected';
  return {
    connectionStatus,
    connected,
    ...(account !== undefined ? { account } : {}),
    defaultMode: settings.defaultMode,
    defaultFormat: settings.defaultFormat,
    target: settings.target,
    confirmFilename: settings.confirmFilename,
    canPickCloudFolder: connected && settings.target === 'cloud',
  };
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
