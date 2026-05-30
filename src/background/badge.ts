/**
 * ChromeBadge (F6-FR5 / F2-FR6) — Badge port over chrome.action. THIN glue: the
 * text/color decision is the covered badgeDisplay; this only writes it.
 * Coverage-excluded.
 */
/* c8 ignore start */
import type { Badge, BadgeState } from '@shared/ports';
import { badgeDisplay } from '@domain/badge-display';
import { api } from '@shared/browser-api';

export class ChromeBadge implements Badge {
  async set(state: BadgeState): Promise<void> {
    const display = badgeDisplay(state);
    await api.action.setBadgeBackgroundColor({ color: display.color });
    await api.action.setBadgeText({ text: display.text });
  }
}
/* c8 ignore stop */
