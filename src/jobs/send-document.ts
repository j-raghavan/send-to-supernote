/**
 * Send-job saga (F6) — the orchestration that ties F2–F5 together.
 *
 * Sequence (driving the domain/job.ts FSM, I-3):
 *   queued
 *   -> ensure token (no token -> notify "connect first", abort)
 *   -> capturing  (reader|fullpage on a clone; empty reader -> "try Full Page")
 *   -> converting (offscreen render -> blob handle)
 *   -> hashing    (read bytes; the adapter computes md5/size)
 *   -> name       (sanitize/fallback + de-dupe vs a REAL folder listing, F6-FR3)
 *   -> uploading  (apply -> PUT)
 *   -> finishing  (finish); done ONLY after finish success (I-3 / F5-FR6)
 *
 * All decision logic lives here (covered); the service worker only wires the
 * real adapters via DI (guard a). Auth failures route to the F2-FR4 recovery
 * with the job retained; other failures are surfaced (and feed the F9 fallback).
 */
import { ok, type Result } from '@shared/result';
import type { Badge, BlobTransfer, Clock, Notifier } from '@shared/ports';
import { type CaptureMode, type CapturedDocument } from '@domain/capture';
import { contentTypeFor, type OutputFormat } from '@domain/conversion';
import { type Target } from '@domain/settings';
import { type DeliveryFailure, findDocumentFolderId, ROOT_DIRECTORY_ID } from '@domain/delivery';
import { completeFinish, type JobState } from '@domain/job';
import { buildUploadFilename } from '@shared/filename';
import type { DeliveryPort, UploadInput } from '@delivery/delivery-port';
import { type DeliveryOutcome, routeDeliveryFailure } from '@delivery/route-delivery-failure';
import { canFallbackToPrivate, offerPrivateCloudFallback } from '@delivery/fallback';
import { DEFAULT_FEATURE_FLAGS, type FeatureFlags, isPathEnabled } from '@shared/feature-flags';
import type { AuthFailureDeps } from '@auth/handle-auth-failure';
import { type CaptureError, type CaptureReaderDeps, captureReader } from '@capture/capture-reader';
import { type CaptureFullPageDeps, captureFullPage } from '@capture/capture-fullpage';
import { captureErrorNotification } from '@capture/capture-error-notification';
import { type RenderDeps, renderDocument } from '@conversion/render-document';
import {
  NOTE_CAPTURING,
  NOTE_CONNECT_FIRST,
  NOTE_CONVERTING,
  noteConversionFailed,
  noteSendFailed,
  noteSent,
  noteUploading,
} from './send-notifications';

/** Active-tab metadata the saga needs that lives outside the captured document. */
export interface PageContext {
  /** Page hostname for the filename fallback (F6-FR3). */
  hostname: string;
}

/** Inputs that pick how this particular send runs (toolbar default or one-off). */
export interface SendRequest {
  mode: CaptureMode;
  format: OutputFormat;
  target: Target;
  /** Destination folder id; falls back to the resolved Document/ folder. */
  folderId?: string;
  /** When true, the user may edit the filename before upload (F6-FR4). */
  confirmFilename: boolean;
  page: PageContext;
}

export interface SendDocumentDeps {
  /** Resolve the DeliveryPort for a target (cloud now; private in F8). */
  resolveDelivery: (target: Target) => DeliveryPort;
  capture: CaptureReaderDeps & CaptureFullPageDeps;
  render: RenderDeps;
  blobs: BlobTransfer;
  notifier: Notifier;
  badge: Badge;
  clock: Clock;
  /** True when a valid token exists for the target (F6-AC6 connect-first gate). */
  hasToken: (target: Target) => Promise<boolean>;
  /** Per-path feature flags (F9-FR4 / I-6); defaults to all-enabled when absent. */
  flags?: FeatureFlags;
  /** The connected account email, used to prefill the re-connect form (F2-FR4). */
  account?: string;
  /** Auth-failure recovery deps (F2-FR4), used when a step returns an auth failure. */
  authDeps: AuthFailureDeps;
  /** Optional filename-confirm hook (F6-FR4); returns the (possibly edited) name. */
  confirmName?: (suggested: string) => Promise<string>;
  /**
   * Optional public->private fallback (F9-FR2). When a NON-AUTH public-Cloud send
   * fails and a Private Cloud is configured, offer to re-send the already-
   * converted blob to the Private Cloud (no re-capture). Absent when no Private
   * Cloud is configured or the current target is already Private Cloud.
   */
  fallback?: {
    /** Build the Private Cloud DeliveryPort for the re-send. */
    privatePort: () => DeliveryPort;
    /** Optional PC default folder id; falls back to the PC Document/ folder. */
    privateFolderId?: string;
    /** One-click prompt; resolves true when the user accepts. */
    offer: () => Promise<boolean>;
  };
}

export type SendErrorKind =
  | 'not-connected'
  | 'path-disabled'
  | 'capture'
  | 'render'
  | 'auth'
  | 'delivery';

export interface SendError {
  kind: SendErrorKind;
  message: string;
  /** The job's terminal state (failed) for callers/persistence. */
  state: JobState;
  /** Present for a delivery failure that should feed the F9 fallback. */
  failure?: DeliveryFailure;
}

export interface SendSuccess {
  fileName: string;
  state: 'done';
}

/** Run the full send saga for one request. */
export async function sendDocument(
  deps: SendDocumentDeps,
  req: SendRequest,
): Promise<Result<SendSuccess, SendError>> {
  // queued -> path enabled? (F9-FR4: a disabled path is unavailable, I-6)
  await deps.badge.set('busy');
  const flags = deps.flags ?? DEFAULT_FEATURE_FLAGS;
  if (!isPathEnabled(flags, req.target)) {
    await deps.notifier.notify(noteSendFailed('This upload path is currently disabled.'));
    await deps.badge.set('error');
    return fail('path-disabled', 'Upload path disabled', 'failed');
  }

  // ensure token (connect-first gate, F6-AC6)
  if (!(await deps.hasToken(req.target))) {
    await deps.notifier.notify(NOTE_CONNECT_FIRST);
    await deps.badge.set('error');
    return fail('not-connected', 'Not connected', 'failed');
  }

  // capturing
  await deps.notifier.notify(NOTE_CAPTURING);
  const captured = await capture(deps, req.mode);
  if (!captured.ok) {
    await deps.notifier.notify(captureErrorNotification(captured.error));
    await deps.badge.set('error');
    return fail('capture', captured.error.message, 'failed');
  }

  // converting
  await deps.notifier.notify(NOTE_CONVERTING);
  const rendered = await renderDocument(deps.render, {
    document: captured.value,
    format: req.format,
  });
  if (!rendered.ok) {
    await deps.notifier.notify(noteConversionFailed(rendered.error.message));
    await deps.badge.set('error');
    return fail('render', rendered.error.message, 'failed');
  }

  // hashing: read bytes back from the blob handle (F1-FR6)
  const stored = await deps.blobs.get(rendered.value.handle);
  if (stored === undefined) {
    await deps.notifier.notify(noteConversionFailed('The rendered document was lost.'));
    await deps.badge.set('error');
    return fail('render', 'Rendered blob missing', 'failed');
  }

  const port = deps.resolveDelivery(req.target);

  // name: resolve destination folder + de-dupe against a REAL listing (F6-FR3/c)
  const destination = await resolveDestination(port, req.folderId);
  const fileName = await resolveFileName(deps, req, port, destination, captured.value);

  // uploading -> finishing -> done (apply -> PUT -> finish inside the adapter, I-3)
  await deps.notifier.notify(noteUploading(fileName));
  const uploadInput = {
    bytes: stored.bytes,
    contentType: contentTypeFor(req.format),
    directoryId: destination,
    fileName,
  };
  const uploaded = await port.uploadDocument(uploadInput);

  if (!uploaded.ok) {
    return finishDeliveryFailure(deps, uploaded.error, req, uploadInput, rendered.value.handle);
  }

  // finish verified by the adapter -> drive the FSM to done (I-3)
  const finalState = completeFinish('finishing', true);
  await cleanupBlob(deps, rendered.value.handle);
  await deps.notifier.notify(noteSent(uploaded.value.fileName));
  await deps.badge.set('idle');
  return ok({ fileName: uploaded.value.fileName, state: finalState as 'done' });
}

async function capture(
  deps: SendDocumentDeps,
  mode: CaptureMode,
): Promise<Result<CapturedDocument, CaptureError>> {
  return mode === 'fullpage' ? captureFullPage(deps.capture) : captureReader(deps.capture);
}

/** Resolve the destination folder id: explicit choice, else the Document/ folder. */
async function resolveDestination(port: DeliveryPort, folderId?: string): Promise<string> {
  if (folderId !== undefined && folderId.length > 0) {
    return folderId;
  }
  const root = await port.listFolders(ROOT_DIRECTORY_ID);
  if (root.ok) {
    const doc = findDocumentFolderId(root.value);
    if (doc !== undefined) {
      return doc;
    }
  }
  return ROOT_DIRECTORY_ID;
}

/** Build the filename, de-duped against the destination's real listing (F6-FR3). */
async function resolveFileName(
  deps: SendDocumentDeps,
  req: SendRequest,
  port: DeliveryPort,
  directoryId: string,
  document: CapturedDocument,
): Promise<string> {
  const listed = await port.listFolders(directoryId);
  const existingNames = listed.ok ? listed.value.map((f) => f.name) : [];
  const suggested = buildUploadFilename({
    title: document.title,
    hostname: req.page.hostname,
    epochMs: deps.clock.now(),
    format: req.format,
    existingNames,
  });
  if (req.confirmFilename && deps.confirmName) {
    return deps.confirmName(suggested);
  }
  return suggested;
}

async function finishDeliveryFailure(
  deps: SendDocumentDeps,
  failure: DeliveryFailure,
  req: SendRequest,
  uploadInput: UploadInput,
  blobHandle: string,
): Promise<Result<SendSuccess, SendError>> {
  const outcome: DeliveryOutcome = await routeDeliveryFailure(failure, deps.authDeps, {
    targetLabel: req.target === 'privatecloud' ? 'Private Cloud' : 'Supernote',
    ...(deps.account !== undefined ? { account: deps.account } : {}),
  });
  if (outcome.kind === 'auth') {
    await deps.badge.set('expired');
    return fail('auth', 'Session expired — reconnect to retry', 'failed');
  }

  // Non-auth public failure: offer the Private Cloud fallback reusing the
  // already-converted blob (F9-FR2). Only eligible from a public-Cloud send with
  // a configured AND enabled Private Cloud path (F9-FR4).
  const privateEnabled = (deps.flags ?? DEFAULT_FEATURE_FLAGS).privateCloudEnabled;
  if (
    req.target === 'cloud' &&
    deps.fallback &&
    privateEnabled &&
    canFallbackToPrivate(failure, true)
  ) {
    const privatePort = deps.fallback.privatePort();
    const destination = await resolveDestination(privatePort, deps.fallback.privateFolderId);
    const fb = await offerPrivateCloudFallback(
      { privatePort: () => privatePort, offer: deps.fallback.offer },
      { ...uploadInput, directoryId: destination },
    );
    if (fb.kind === 'sent') {
      await deps.blobs.delete(blobHandle);
      await deps.notifier.notify(noteSent(fb.result.fileName));
      await deps.badge.set('idle');
      return ok({
        fileName: fb.result.fileName,
        state: completeFinish('finishing', true) as 'done',
      });
    }
  }

  await deps.notifier.notify(noteSendFailed(failure.message));
  await deps.badge.set('error');
  return {
    ok: false,
    error: { kind: 'delivery', message: failure.message, state: 'failed', failure },
  };
}

async function cleanupBlob(deps: SendDocumentDeps, handle: string): Promise<void> {
  await deps.blobs.delete(handle);
}

function fail(kind: SendErrorKind, message: string, state: JobState): Result<never, SendError> {
  return { ok: false, error: { kind, message, state } };
}
