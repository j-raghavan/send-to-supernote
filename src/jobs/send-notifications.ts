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

/**
 * Shown when no destination folder can be resolved. Supernote rejects uploads to
 * the root directory ("Cannot be operated from the root directory!"), so rather
 * than attempt a doomed root upload we ask the user to pick a folder in Options.
 */
export const NOTE_NO_DESTINATION_FOLDER: Notification = {
  level: 'error',
  title: 'Choose a folder',
  message:
    "Couldn't find a destination folder on your Supernote. Open Options and pick one to send to.",
};

export function noteSendFailed(reason: string): Notification {
  return { level: 'error', title: 'Send failed', message: reason };
}

export function noteConversionFailed(reason: string): Notification {
  return { level: 'error', title: 'Conversion failed', message: reason };
}

export function noteCaptureFailed(reason: string): Notification {
  return { level: 'error', title: "Couldn't capture this page", message: reason };
}

/**
 * Full Page hit the capture cap (FP6-FR1) — the document was sent, but only the
 * top portion was captured. A warning, not a failure: the send still succeeds.
 */
export function noteFullPageTruncated(): Notification {
  return {
    level: 'warning',
    title: 'Full Page was capped',
    message: 'This page was very long — only the captured portion was sent.',
  };
}
