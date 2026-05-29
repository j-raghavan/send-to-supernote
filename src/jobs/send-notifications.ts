/**
 * Send-job notification content (F6-FR5) — covered, pure.
 *
 * Centralizes the progress/result toast copy so it is testable and consistent
 * (capturing -> converting -> uploading -> done; final success or actionable
 * failure). The saga emits these via the Notifier port; the chrome.notifications
 * write is the thin adapter.
 */
import type { Notification } from '@shared/ports';

export const NOTE_CAPTURING: Notification = {
  level: 'progress',
  title: 'Capturing',
  message: 'Capturing the page…',
};

export const NOTE_CONVERTING: Notification = {
  level: 'progress',
  title: 'Converting',
  message: 'Building the document…',
};

export function noteUploading(fileName: string): Notification {
  return { level: 'progress', title: 'Uploading', message: `Sending ${fileName}…` };
}

export function noteSent(fileName: string): Notification {
  return {
    level: 'success',
    title: 'Sent to Supernote',
    message: `${fileName} — sync your device to see it.`,
  };
}

export const NOTE_CONNECT_FIRST: Notification = {
  level: 'error',
  title: 'Connect first',
  message: 'Connect your Supernote account in Options.',
};

export function noteSendFailed(reason: string): Notification {
  return { level: 'error', title: 'Send failed', message: reason };
}

export function noteConversionFailed(reason: string): Notification {
  return { level: 'error', title: 'Conversion failed', message: reason };
}
