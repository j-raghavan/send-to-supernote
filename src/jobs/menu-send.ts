/**
 * Context-menu send resolution (F6-FR2).
 *
 * Maps a clicked context-menu item id to a SendRequest: resolve the menu's
 * capture mode and apply it as a one-off override on the stored settings.
 * Returns undefined for an unrecognized id so the SW callback stays a pure
 * delegator (guard a). Covered.
 */
import { captureModeForMenuItem } from '@capture/triggers';
import type { Settings } from '@domain/settings';
import { resolveSendRequest } from './resolve-send-request';
import type { PageContext, SendRequest } from './send-document';

/** Build the SendRequest for a clicked menu item, or undefined if unrecognized. */
export function menuSendRequest(
  menuItemId: string,
  settings: Settings,
  page: PageContext,
): SendRequest | undefined {
  const mode = captureModeForMenuItem(menuItemId);
  if (mode === undefined) {
    return undefined;
  }
  return resolveSendRequest(settings, page, { mode });
}
