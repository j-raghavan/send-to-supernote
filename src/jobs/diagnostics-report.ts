/**
 * Connection Doctor diagnostics report — the pure text the `Copy diagnostics`
 * button puts on the clipboard, paste-ready for a bug report.
 *
 * Privacy by construction (D-2): the report is assembled only from values that
 * carry no secret. The Diagnosis holds the structured S3 error (code, signed
 * headers, canonical request) and human messages; it never holds the access
 * token, the `s3Authorization`, the account email, or the presigned URL (whose
 * query string is the only secret-bearing part). S3 deliberately omits the
 * signature from the canonical request it echoes back, so sharing it is safe.
 */
import { contentTypeFor } from '@domain/conversion';
import type { Target } from '@domain/settings';
import type { Diagnosis, DoctorFormatResult } from './connection-doctor';

const RULE = '─────────────────────────────';

export interface DiagnosticsEnv {
  /** Extension version (manifest / package). */
  version: string;
  /** Raw `navigator.userAgent`; contains the browser and OS, no secret. */
  userAgent: string;
}

/** Human label for a target (matches the Options panel headings). */
function targetLabel(target: Target): string {
  return target === 'privatecloud' ? 'Private Cloud' : 'Supernote Cloud (public)';
}

/** True when every probed format delivered. */
export function isHealthy(diagnosis: Diagnosis): boolean {
  return diagnosis.results.length > 0 && diagnosis.results.every((r) => r.ok);
}

/** One-line-per-format summary, e.g. `PDF  : ✓ delivered`. */
function summaryLine(result: DoctorFormatResult): string {
  const label = result.format.toUpperCase().padEnd(4);
  if (result.ok) {
    return `${label}: ✓ delivered`;
  }
  const where = result.stage === 'render' ? 'render' : 'delivery';
  return `${label}: ✕ failed at ${where}: ${result.message ?? 'unknown error'}`;
}

/** The detail block for a failed delivery: sent content type + S3 specifics. */
function deliveryDetail(result: DoctorFormatResult): string[] {
  const lines: string[] = [];
  lines.push(`  Sent Content-Type : ${contentTypeFor(result.format)}`);
  const s3 = result.failure?.s3;
  if (s3 === undefined) {
    return lines;
  }
  if (s3.code !== undefined) {
    lines.push(`  S3 Code           : ${s3.code}`);
  }
  if (s3.signedHeaders !== undefined) {
    lines.push(`  S3 SignedHeaders  : ${s3.signedHeaders}`);
  }
  if (s3.canonicalRequest !== undefined) {
    lines.push('  S3 CanonicalRequest:');
    for (const line of s3.canonicalRequest.split('\n')) {
      lines.push(`    ${line}`);
    }
  }
  return lines;
}

/**
 * Build the full diagnostics text. Deterministic and side-effect-free; the UI
 * stamps the live `version`/`userAgent` and copies the result to the clipboard.
 */
export function formatDiagnostics(env: DiagnosticsEnv, diagnosis: Diagnosis): string {
  const lines: string[] = [
    'send-to-supernote diagnostics',
    RULE,
    `Version : ${env.version}`,
    `Target  : ${targetLabel(diagnosis.target)}`,
    `Browser : ${env.userAgent}`,
    '',
  ];
  for (const result of diagnosis.results) {
    lines.push(summaryLine(result));
    if (!result.ok && result.stage === 'delivery') {
      lines.push(...deliveryDetail(result));
    }
  }
  lines.push(RULE, 'Contains no password, token, or account secrets.');
  return lines.join('\n');
}
