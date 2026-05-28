/**
 * Badge display mapping (F6-FR5 / F2-FR6) — pure, covered.
 *
 * Maps a BadgeState to the toolbar text + color: in-flight shows "…", error
 * "!", expired "!", idle clears the badge. The chrome.action write is the thin
 * adapter; this decision lives here so it is unit-tested.
 */
import type { BadgeState } from '@shared/ports';

export interface BadgeDisplay {
  text: string;
  /** RGBA color for the badge background. */
  color: string;
}

const DISPLAY: Record<BadgeState, BadgeDisplay> = {
  idle: { text: '', color: '#000000' },
  busy: { text: '…', color: '#2962ff' },
  error: { text: '!', color: '#d32f2f' },
  expired: { text: '!', color: '#f9a825' },
};

export function badgeDisplay(state: BadgeState): BadgeDisplay {
  return DISPLAY[state];
}
