import { describe, expect, it } from 'vitest';
import { formatDiagnostics, isHealthy, type DiagnosticsEnv } from '@jobs/diagnostics-report';
import type { Diagnosis } from '@jobs/connection-doctor';

const env: DiagnosticsEnv = {
  version: '1.5.4',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/126',
};

const healthy: Diagnosis = {
  target: 'cloud',
  results: [
    { format: 'pdf', fileName: 'send-to-supernote-diagnostics.pdf', ok: true },
    { format: 'epub', fileName: 'send-to-supernote-diagnostics.epub', ok: true },
  ],
};

const partial: Diagnosis = {
  target: 'cloud',
  results: [
    { format: 'pdf', fileName: 'send-to-supernote-diagnostics.pdf', ok: true },
    {
      format: 'epub',
      fileName: 'send-to-supernote-diagnostics.epub',
      ok: false,
      stage: 'delivery',
      message: 'S3 upload failed (HTTP 403: SignatureDoesNotMatch)',
      failure: {
        kind: 'protocol',
        message: 'S3 upload failed (HTTP 403: SignatureDoesNotMatch)',
        s3: {
          httpStatus: 403,
          code: 'SignatureDoesNotMatch',
          signedHeaders: 'content-type;host;x-amz-date',
          canonicalRequest:
            'PUT\n/sn-files/obj-abc\n\ncontent-type:application/epub+zip\nhost:s3\n\n' +
            'content-type;host;x-amz-date\nUNSIGNED-PAYLOAD',
        },
      },
    },
  ],
};

describe('isHealthy', () => {
  it('is true only when every probed format delivered', () => {
    expect(isHealthy(healthy)).toBe(true);
    expect(isHealthy(partial)).toBe(false);
    expect(isHealthy({ target: 'cloud', results: [] })).toBe(false);
  });
});

describe('formatDiagnostics', () => {
  it('includes version, target label, and browser', () => {
    const text = formatDiagnostics(env, healthy);
    expect(text).toContain('Version : 1.5.4');
    expect(text).toContain('Target  : Supernote Cloud (public)');
    expect(text).toContain('Chrome/126');
  });

  it('labels the Private Cloud target', () => {
    const text = formatDiagnostics(env, { ...healthy, target: 'privatecloud' });
    expect(text).toContain('Target  : Private Cloud');
  });

  it('summarizes each format with a tick on success', () => {
    const text = formatDiagnostics(env, healthy);
    expect(text).toContain('PDF : ✓ delivered');
    expect(text).toContain('EPUB: ✓ delivered');
  });

  it('expands a delivery failure with sent content type and S3 specifics', () => {
    const text = formatDiagnostics(env, partial);
    expect(text).toContain('PDF : ✓ delivered');
    expect(text).toContain('EPUB: ✕ failed at delivery: S3 upload failed');
    expect(text).toContain('Sent Content-Type : application/epub+zip');
    expect(text).toContain('S3 Code           : SignatureDoesNotMatch');
    expect(text).toContain('S3 SignedHeaders  : content-type;host;x-amz-date');
    expect(text).toContain('S3 CanonicalRequest:');
    expect(text).toContain('content-type:application/epub+zip');
  });

  it('marks a render failure without an S3 detail block', () => {
    const renderFail: Diagnosis = {
      target: 'cloud',
      results: [
        {
          format: 'pdf',
          fileName: 'send-to-supernote-diagnostics.pdf',
          ok: false,
          stage: 'render',
          message: 'render failed',
        },
      ],
    };
    const text = formatDiagnostics(env, renderFail);
    expect(text).toContain('PDF : ✕ failed at render: render failed');
    expect(text).not.toContain('Sent Content-Type');
  });

  it('never leaks a token, authorization, email, or URL signature', () => {
    // The report is assembled only from non-secret fields; assert the structural
    // guarantee holds for a realistic failure payload.
    const text = formatDiagnostics(env, partial).toLowerCase();
    expect(text).not.toContain('x-amz-signature');
    expect(text).not.toContain('authorization');
    expect(text).not.toContain('x-access-token');
    expect(text).not.toContain('@');
  });

  it('states it carries no secrets', () => {
    expect(formatDiagnostics(env, healthy)).toContain('no password, token, or account secrets');
  });

  it('falls back to "unknown error" when a failed result has no message', () => {
    const d: Diagnosis = {
      target: 'cloud',
      results: [{ format: 'pdf', fileName: 'x.pdf', ok: false }],
    };
    expect(formatDiagnostics(env, d)).toContain('PDF : ✕ failed at delivery: unknown error');
  });

  it('shows only the sent content type when a delivery failure has no S3 detail', () => {
    const noS3: Diagnosis = {
      target: 'privatecloud',
      results: [
        {
          format: 'pdf',
          fileName: 'send-to-supernote-diagnostics.pdf',
          ok: false,
          stage: 'delivery',
          message: 'No Document folder was found to deliver to.',
        },
      ],
    };
    const text = formatDiagnostics(env, noS3);
    expect(text).toContain('Sent Content-Type : application/pdf');
    expect(text).not.toContain('S3 Code');
    expect(text).not.toContain('S3 SignedHeaders');
  });

  it('omits absent S3 sub-fields when only the status is known', () => {
    const minimal: Diagnosis = {
      target: 'cloud',
      results: [
        {
          format: 'epub',
          fileName: 'send-to-supernote-diagnostics.epub',
          ok: false,
          stage: 'delivery',
          message: 'S3 upload failed (HTTP 500)',
          failure: {
            kind: 'protocol',
            message: 'S3 upload failed (HTTP 500)',
            s3: { httpStatus: 500 },
          },
        },
      ],
    };
    const text = formatDiagnostics(env, minimal);
    expect(text).toContain('Sent Content-Type : application/epub+zip');
    expect(text).not.toContain('S3 Code');
    expect(text).not.toContain('S3 SignedHeaders');
    expect(text).not.toContain('S3 CanonicalRequest');
  });
});
