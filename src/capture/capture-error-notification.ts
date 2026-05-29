/**
 * Map a capture failure to an actionable user notification (F3-FR5 / F3-AC4).
 *
 * Surfaces the failure message so the user knows the page had no readable
 * content and no empty document is ever uploaded. Pure mapping (covered); the
 * saga/UI delivers the notification via the Notifier port.
 */
import type { Notification } from '@shared/ports';
import type { CaptureError } from './capture-reader';

export function captureErrorNotification(error: CaptureError): Notification {
  return {
    level: 'error',
    title: "Couldn't capture this page",
    message: error.message,
  };
}
