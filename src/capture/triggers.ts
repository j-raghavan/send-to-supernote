/**
 * Capture triggers (F4-FR1 / F6-FR2) — the context-menu item descriptors and
 * the menu-id -> capture-mode mapping.
 *
 * Pure data + a resolver (covered): the thin background/context-menus.ts adapter
 * registers these via chrome.contextMenus and dispatches clicks through
 * captureModeForMenuItem. Keeping the descriptors here makes the menu wiring
 * testable and keeps the adapter logic-free.
 */
import type { CaptureMode } from '@domain/capture';

export interface MenuItem {
  id: string;
  title: string;
  mode: CaptureMode;
  /** Right-click contexts the item appears in. */
  contexts: readonly ['page'];
}

export const MENU_READER: MenuItem = {
  id: 'send-to-supernote-reader',
  title: 'Send to Supernote',
  mode: 'reader',
  contexts: ['page'],
};

/** Full Page entry point — captures the page as-is to an image-based PDF (FP1-FR2). */
export const MENU_FULLPAGE: MenuItem = {
  id: 'send-to-supernote-fullpage',
  title: 'Send to Supernote (Full Page)',
  mode: 'fullpage',
  contexts: ['page'],
};

export const MENU_ITEMS: readonly MenuItem[] = [MENU_READER, MENU_FULLPAGE];

/** Resolve the capture mode for a clicked context-menu item id, if recognized. */
export function captureModeForMenuItem(menuItemId: string): CaptureMode | undefined {
  return MENU_ITEMS.find((item) => item.id === menuItemId)?.mode;
}
