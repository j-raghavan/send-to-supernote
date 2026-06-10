/**
 * Connection Doctor (Options > Advanced > Troubleshoot connection).
 *
 * "Connected" today only means a token is stored; it never touches S3, so a
 * broken delivery path looks healthy until a real send fails. The Doctor proves
 * delivery by running the SAME render -> apply -> PUT -> finish pipeline a real
 * send uses, for a tiny PDF and EPUB, to the `Document/` folder.
 *
 * Both formats are probed because the content type is a prime suspect for a
 * `SignatureDoesNotMatch`: if PDF succeeds and EPUB fails, the divergence is
 * localized for free, and the user gets a workaround. Each per-format result
 * carries the structured DeliveryFailure (incl. S3 signed headers / canonical
 * request) so the diagnostics payload can name the exact header that diverged.
 *
 * All decision logic lives here (covered); the real Renderer / BlobTransfer /
 * DeliveryPort are injected, so the whole pipeline is fake-testable.
 */
import type { BlobTransfer } from '@shared/ports';
import { contentTypeFor, type OutputFormat } from '@domain/conversion';
import type { Target } from '@domain/settings';
import type { DeliveryFailure } from '@domain/delivery';
import type { DeliveryPort } from '@delivery/delivery-port';
import { resolveDestination } from '@delivery/resolve-destination';
import { type RenderDeps, renderDocument } from '@conversion/render-document';

/** Fixed name of the test files dropped in `Document/` (one per format). */
export const DIAGNOSTIC_BASENAME = 'send-to-supernote-diagnostics';

const DIAGNOSTIC_TITLE = 'Send to Supernote connection test';
const DIAGNOSTIC_HTML =
  '<h1>Send to Supernote</h1>' +
  '<p>This file was created by the Connection Doctor to confirm that delivery ' +
  'to your Supernote works. It is safe to delete.</p>';

/** Formats probed, in order. PDF first so a PDF-only success reads naturally. */
const DIAGNOSTIC_FORMATS: readonly OutputFormat[] = ['pdf', 'epub'];

/** Where a probe failed: rendering the test doc, or delivering it. */
export type DoctorStage = 'render' | 'delivery';

export interface DoctorFormatResult {
  format: OutputFormat;
  fileName: string;
  ok: boolean;
  /** Present only on failure: which stage failed. */
  stage?: DoctorStage;
  /** Present only on failure: the human-readable reason. */
  message?: string;
  /** Present when a delivery step failed: the canonical failure (carries `s3`). */
  failure?: DeliveryFailure;
}

export interface Diagnosis {
  target: Target;
  results: DoctorFormatResult[];
}

export interface ConnectionDoctorDeps {
  resolveDelivery: (target: Target) => DeliveryPort;
  render: RenderDeps;
  blobs: BlobTransfer;
}

/**
 * Precondition for probing a target: it must have stored credentials. Without
 * this guard, resolveDelivery lets the public adapter silently stand in for an
 * unconfigured Private Cloud, so the probe would hit Supernote Cloud yet be
 * reported as "Private Cloud". Returns an actionable message to show instead of
 * probing, or undefined when the target is ready.
 */
export function troubleshootPrecondition(
  target: Target,
  creds: { cloudToken: string; privateCloudConfigured: boolean },
): string | undefined {
  if (target === 'privatecloud' && !creds.privateCloudConfigured) {
    return 'Connect your Private Cloud server first.';
  }
  if (target === 'cloud' && creds.cloudToken.length === 0) {
    return 'Connect to Supernote Cloud first.';
  }
  return undefined;
}

/** Run the Connection Doctor against a target: probe each format, collect results. */
export async function runConnectionDoctor(
  deps: ConnectionDoctorDeps,
  target: Target,
): Promise<Diagnosis> {
  const port = deps.resolveDelivery(target);
  const results: DoctorFormatResult[] = [];
  for (const format of DIAGNOSTIC_FORMATS) {
    results.push(await probeFormat(deps, port, format));
  }
  return { target, results };
}

/** Render -> resolve Document/ -> deliver one format; never throws (returns a result). */
async function probeFormat(
  deps: ConnectionDoctorDeps,
  port: DeliveryPort,
  format: OutputFormat,
): Promise<DoctorFormatResult> {
  const fileName = `${DIAGNOSTIC_BASENAME}.${format}`;

  const rendered = await renderDocument(deps.render, {
    document: { mode: 'reader', title: DIAGNOSTIC_TITLE, html: DIAGNOSTIC_HTML },
    format,
    includeImages: true,
  });
  if (!rendered.ok) {
    return { format, fileName, ok: false, stage: 'render', message: rendered.error.message };
  }

  const stored = await deps.blobs.get(rendered.value.handle);
  if (stored === undefined) {
    return {
      format,
      fileName,
      ok: false,
      stage: 'render',
      message: 'The rendered test document was lost.',
    };
  }

  const directoryId = await resolveDestination(port);
  if (directoryId === undefined) {
    await releaseBlob(deps, rendered.value.handle);
    return {
      format,
      fileName,
      ok: false,
      stage: 'delivery',
      message: 'No Document folder was found to deliver to.',
    };
  }

  const uploaded = await port.uploadDocument({
    bytes: stored.bytes,
    contentType: contentTypeFor(format),
    directoryId,
    fileName,
  });
  await releaseBlob(deps, rendered.value.handle);

  if (!uploaded.ok) {
    return {
      format,
      fileName,
      ok: false,
      stage: 'delivery',
      message: uploaded.error.message,
      failure: uploaded.error,
    };
  }
  return { format, fileName, ok: true };
}

/** Free the test blob; best-effort, so cleanup never turns a probe into a failure. */
async function releaseBlob(deps: ConnectionDoctorDeps, handle: string): Promise<void> {
  try {
    await deps.blobs.delete(handle);
  } catch {
    // Cleanup is advisory; a failed delete must not fail the diagnosis.
  }
}
