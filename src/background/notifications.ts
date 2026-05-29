/**
 * ChromeNotifier (F6-FR5) — Notifier port over chrome.notifications. THIN glue:
 * maps the canonical Notification level to a basic notification. No decision
 * logic (message content is built by covered modules). Coverage-excluded.
 */
/* c8 ignore start */
import type { Notification, Notifier } from '@shared/ports';

const ICON = 'icons/icon128.png';

export class ChromeNotifier implements Notifier {
  notify(notification: Notification): Promise<void> {
    return new Promise((resolve) => {
      chrome.notifications.create(
        {
          type: 'basic',
          iconUrl: ICON,
          title: notification.title,
          message: notification.message,
        },
        () => resolve(),
      );
    });
  }
}
/* c8 ignore stop */
