/**
 * Integration (mocked network): full Reader View -> public Cloud send.
 *
 * Composes the real use cases — captureReader -> renderDocument -> uploadToCloud
 * — over fakes, and asserts the destination audit (F5-FR5 / F5-AC5 / I-2 / D-3):
 * every network destination is ONLY viewer.supernote.com or Ratta's S3 host. No
 * third party, no project backend.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { captureReader } from '../../src/capture/capture-reader';
import { renderDocument } from '../../src/conversion/render-document';
import { APPLY_PATH, FINISH_PATH, uploadToCloud } from '../../src/delivery/public-cloud-adapter';
import { DEFAULT_PUBLIC_PROFILE } from '@domain/delivery';
import { contentTypeFor } from '@domain/conversion';
import { FakeExtractor } from '../fakes/fake-extractor';
import { FakeRenderer } from '../fakes/fake-renderer';
import { FakeHttpClient } from '../fakes/fake-http-client';

const S3_URL = 'https://supernote-bucket.s3.amazonaws.com/Document/web-clip-xyz?X-Amz-Sig=zzz';

function allowedDestination(url: string): boolean {
  const host = new URL(url).host;
  return host === 'viewer.supernote.com' || host.endsWith('.amazonaws.com');
}

describe('Reader View -> public Cloud (integration, D-3/I-2)', () => {
  let http: FakeHttpClient;

  beforeEach(() => {
    http = new FakeHttpClient()
      .on(APPLY_PATH, { status: 200, json: { success: true, url: S3_URL } })
      .on('s3.amazonaws.com', { status: 200 })
      .on(FINISH_PATH, { status: 200, json: { success: true } });
  });

  it('captures, renders, uploads, and contacts only Supernote Cloud + Ratta S3', async () => {
    // 1. capture (Reader View on a clone — I-4 enforced in the adapter)
    const captured = await captureReader(
      {
        extractor: new FakeExtractor({
          title: 'A Web Article',
          content: '<h1>A Web Article</h1><p>'.padEnd(80, 'x') + '</p>',
          length: 900,
        }),
      },
      true,
    );
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    // 2. render to a PDF blob (offscreen renderer faked)
    const rendered = await renderDocument(
      { renderer: new FakeRenderer(2048) },
      { document: captured.value, format: 'pdf', includeImages: true },
    );
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;

    // 3. upload apply -> PUT -> finish
    const uploaded = await uploadToCloud(
      { http, profile: DEFAULT_PUBLIC_PROFILE, token: 'tok' },
      {
        bytes: new Uint8Array([1, 2, 3, 4]),
        contentType: contentTypeFor('pdf'),
        directoryId: '7',
        fileName: 'A-Web-Article.pdf',
      },
    );
    expect(uploaded.ok).toBe(true);

    // Destination audit (F5-FR5 / F5-AC5): only viewer.supernote.com + S3.
    expect(http.urls.length).toBe(3);
    for (const url of http.urls) {
      expect(allowedDestination(url), `unexpected destination: ${url}`).toBe(true);
    }
  });

  it('the apply and finish calls go to viewer.supernote.com; the PUT goes to S3', async () => {
    await uploadToCloud(
      { http, profile: DEFAULT_PUBLIC_PROFILE, token: 'tok' },
      {
        bytes: new Uint8Array([9]),
        contentType: 'application/pdf',
        directoryId: '7',
        fileName: 'x.pdf',
      },
    );
    expect(new URL(http.urls[0]!).host).toBe('viewer.supernote.com');
    expect(new URL(http.urls[1]!).host).toContain('amazonaws.com');
    expect(new URL(http.urls[2]!).host).toBe('viewer.supernote.com');
  });
});
