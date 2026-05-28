/**
 * recordedSend (F6-FR6 / F9 watchlist #4) — runs the saga and records the
 * terminal outcome into the local JobHistory so the popup's "recent sends" list
 * is populated. Pure wrapper over sendDocument + JobHistory; keeps the saga's
 * many internal terminal points free of history concerns (single record point).
 */
import type { Result } from '@shared/result';
import {
  sendDocument,
  type SendDocumentDeps,
  type SendError,
  type SendRequest,
  type SendSuccess,
} from './send-document';
import type { JobHistory } from './job-history';

/** Run a send and record its done/failed outcome to history. */
export async function recordedSend(
  history: JobHistory,
  deps: SendDocumentDeps,
  req: SendRequest,
): Promise<Result<SendSuccess, SendError>> {
  const result = await sendDocument(deps, req);
  if (result.ok) {
    await history.record(result.value.fileName, 'done');
  } else {
    await history.record(fallbackName(req), 'failed', result.error.message);
  }
  return result;
}

/** A best-effort name for a failed send (the real filename may not be resolved yet). */
function fallbackName(req: SendRequest): string {
  return `${req.page.hostname} (${req.mode})`;
}
