/**
 * Context-menu adapter (F4-FR1 / F6-FR2) — THIN chrome.contextMenus glue.
 *
 * Registers the capture menu items (descriptors from capture/triggers) and
 * dispatches a click to the supplied handler with the resolved capture mode.
 * No decision logic (the id->mode mapping is the covered captureModeForMenuItem).
 * Coverage-excluded (architecture §9.3): bare chrome.* calls.
 */
/* c8 ignore start */
import { captureModeForMenuItem, MENU_ITEMS } from '../capture/triggers';
import type { CaptureMode } from '@domain/capture';
import { api } from '@shared/browser-api';

/** Register the capture context-menu items (idempotent: removes all first). */
export function registerContextMenus(): void {
  api.contextMenus.removeAll(() => {
    for (const item of MENU_ITEMS) {
      api.contextMenus.create({
        id: item.id,
        title: item.title,
        contexts: [...item.contexts],
      });
    }
  });
}

/** Wire menu clicks to a capture handler. */
export function onContextMenuClicked(handler: (mode: CaptureMode) => void): void {
  api.contextMenus.onClicked.addListener((info) => {
    const mode = captureModeForMenuItem(String(info.menuItemId));
    if (mode) {
      handler(mode);
    }
  });
}
/* c8 ignore stop */
