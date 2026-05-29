/**
 * Settings value object (Data Model, F7) — pure types + defaults + validation.
 *
 * The send-job saga (F6) READS these; the Options page (F7) writes them. Defined
 * here so both share one contract. No I/O — persistence is the SettingsStore over
 * the KeyValueStore port.
 */
import type { CaptureMode } from '@domain/capture';
import type { OutputFormat } from '@domain/conversion';

export type { CaptureMode } from '@domain/capture';
export type { OutputFormat } from '@domain/conversion';

/** Delivery target: public Supernote Cloud or the self-hosted Private Cloud (D-4). */
export type Target = 'cloud' | 'privatecloud';

export interface Settings {
  defaultMode: CaptureMode;
  defaultFormat: OutputFormat;
  target: Target;
  /** Target folder id for the public Cloud account (default = Document/). */
  cloudFolderId?: string;
  /** When true, prompt to edit the filename before each upload (F6-FR4). */
  confirmFilename: boolean;
}

/**
 * Defaults applied when nothing is stored yet: Reader + EPUB + public Cloud.
 * EPUB is reflowable (ideal for e-ink) and renders by zipping the article HTML —
 * it skips html2canvas rasterization, which is unreliable in a non-visible
 * offscreen document and chokes on cross-origin images.
 */
export const DEFAULT_SETTINGS: Settings = {
  defaultMode: 'reader',
  defaultFormat: 'epub',
  target: 'cloud',
  confirmFilename: false,
};

const CAPTURE_MODES: ReadonlySet<string> = new Set<CaptureMode>(['reader']);
const OUTPUT_FORMATS: ReadonlySet<string> = new Set<OutputFormat>(['pdf', 'epub']);
const TARGETS: ReadonlySet<string> = new Set<Target>(['cloud', 'privatecloud']);

export function isCaptureMode(value: unknown): value is CaptureMode {
  return typeof value === 'string' && CAPTURE_MODES.has(value);
}

export function isOutputFormat(value: unknown): value is OutputFormat {
  return typeof value === 'string' && OUTPUT_FORMATS.has(value);
}

export function isTarget(value: unknown): value is Target {
  return typeof value === 'string' && TARGETS.has(value);
}
