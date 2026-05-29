/**
 * Fallback offer prompt (F9-FR2) — THIN api.notifications glue.
 *
 * The public->private fallback offer is a one-click notification with a "Send to
 * your Private Cloud instead" button; the returned promise resolves true when the
 * user clicks it (and false if dismissed). No decision logic — the eligibility
 * (canFallbackToPrivate) and the re-send live in the covered saga/fallback.
 * Coverage-excluded.
 */
/* c8 ignore start */
import { api } from '@shared/browser-api';

const ICON = 'icons/icon128.png';
const ACCEPT_BUTTON = 0;

export function offerFallbackPrompt(): Promise<boolean> {
  return new Promise((resolve) => {
    api.notifications.create(
      {
        type: 'basic',
        iconUrl: ICON,
        title: 'Supernote Cloud send failed',
        message: 'Send this to your Private Cloud server instead?',
        buttons: [{ title: 'Send to Private Cloud' }],
        requireInteraction: true,
      },
      (notificationId) => {
        const onClick = (clickedId: string, buttonIndex: number): void => {
          if (clickedId === notificationId && buttonIndex === ACCEPT_BUTTON) {
            cleanup();
            resolve(true);
          }
        };
        const onClosed = (closedId: string): void => {
          if (closedId === notificationId) {
            cleanup();
            resolve(false);
          }
        };
        const cleanup = (): void => {
          api.notifications.onButtonClicked.removeListener(onClick);
          api.notifications.onClosed.removeListener(onClosed);
        };
        api.notifications.onButtonClicked.addListener(onClick);
        api.notifications.onClosed.addListener(onClosed);
      },
    );
  });
}
/* c8 ignore stop */
