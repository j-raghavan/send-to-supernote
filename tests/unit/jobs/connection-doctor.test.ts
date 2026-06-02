import { beforeEach, describe, expect, it } from 'vitest';
import { ok, err } from '@shared/result';
import {
  DIAGNOSTIC_BASENAME,
  type ConnectionDoctorDeps,
  runConnectionDoctor,
  troubleshootPrecondition,
} from '@jobs/connection-doctor';
import type { DeliveryFailure } from '@domain/delivery';
import { InMemoryBlobTransfer } from '../../../src/background/in-memory-blob-transfer';
import { FakeRenderer } from '../../fakes/fake-renderer';
import { FakeDeliveryPort } from '../../fakes/fake-delivery-port';
import { FakeRandomSource } from '../../fakes/fake-random-source';

interface Harness {
  deps: ConnectionDoctorDeps;
  port: FakeDeliveryPort;
  blobs: InMemoryBlobTransfer;
  renderer: FakeRenderer;
}

function harness(): Harness {
  const blobs = new InMemoryBlobTransfer(new FakeRandomSource());
  const renderer = new FakeRenderer(64, blobs);
  const port = new FakeDeliveryPort();
  const deps: ConnectionDoctorDeps = {
    resolveDelivery: () => port,
    render: { renderer },
    blobs,
  };
  return { deps, port, blobs, renderer };
}

describe('runConnectionDoctor', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('probes both PDF and EPUB through the real render -> deliver pipeline', async () => {
    const diagnosis = await runConnectionDoctor(h.deps, 'cloud');
    expect(diagnosis.target).toBe('cloud');
    expect(diagnosis.results.map((r) => r.format)).toEqual(['pdf', 'epub']);
    expect(diagnosis.results.every((r) => r.ok)).toBe(true);
    expect(h.port.uploadCalls).toHaveLength(2);
  });

  it('names the diagnostics files with the fixed basename per format', async () => {
    const diagnosis = await runConnectionDoctor(h.deps, 'cloud');
    expect(diagnosis.results[0]!.fileName).toBe(`${DIAGNOSTIC_BASENAME}.pdf`);
    expect(diagnosis.results[1]!.fileName).toBe(`${DIAGNOSTIC_BASENAME}.epub`);
  });

  it('sends the correct content type for each format', async () => {
    await runConnectionDoctor(h.deps, 'cloud');
    expect(h.port.uploadCalls[0]!.contentType).toBe('application/pdf');
    expect(h.port.uploadCalls[1]!.contentType).toBe('application/epub+zip');
  });

  it('delivers to the resolved Document/ folder', async () => {
    await runConnectionDoctor(h.deps, 'cloud');
    expect(h.port.uploadCalls[0]!.directoryId).toBe('default-doc');
  });

  it('frees the test blob after each probe (handles are sequential 1, 2)', async () => {
    await runConnectionDoctor(h.deps, 'cloud');
    expect(await h.blobs.get('00000000-0000-0000-0000-000000000001')).toBeUndefined();
    expect(await h.blobs.get('00000000-0000-0000-0000-000000000002')).toBeUndefined();
  });

  it('carries the structured DeliveryFailure (incl. s3) on a delivery failure', async () => {
    const failure: DeliveryFailure = {
      kind: 'protocol',
      message: 'S3 upload failed (HTTP 403: SignatureDoesNotMatch)',
      s3: {
        httpStatus: 403,
        code: 'SignatureDoesNotMatch',
        signedHeaders: 'content-type;host;x-amz-date',
        canonicalRequest: 'PUT\n/k\n\ncontent-type:application/epub+zip\n...',
      },
    };
    h.port.uploadResult = err(failure);
    const diagnosis = await runConnectionDoctor(h.deps, 'cloud');
    const epub = diagnosis.results[1]!;
    expect(epub.ok).toBe(false);
    expect(epub.stage).toBe('delivery');
    expect(epub.failure?.s3?.code).toBe('SignatureDoesNotMatch');
  });

  it('reports a render failure without attempting delivery', async () => {
    h.renderer.failNext = 99;
    const diagnosis = await runConnectionDoctor(h.deps, 'cloud');
    expect(diagnosis.results.every((r) => !r.ok && r.stage === 'render')).toBe(true);
    expect(h.port.uploadCalls).toHaveLength(0);
  });

  it('fails the delivery stage when no Document folder resolves', async () => {
    h.port.defaultFolders = ok([]);
    const diagnosis = await runConnectionDoctor(h.deps, 'cloud');
    expect(diagnosis.results.every((r) => !r.ok && r.stage === 'delivery')).toBe(true);
    expect(h.port.uploadCalls).toHaveLength(0);
  });

  it('fails the delivery stage when the root listing errors', async () => {
    h.port.foldersByDirectory.set('0', err({ kind: 'connection', message: 'offline' }));
    const diagnosis = await runConnectionDoctor(h.deps, 'cloud');
    expect(diagnosis.results.every((r) => !r.ok && r.stage === 'delivery')).toBe(true);
  });

  it('reports a render failure when the rendered blob is lost', async () => {
    // A renderer NOT backed by the shared blob store returns a dangling handle,
    // so blobs.get resolves undefined — the "rendered document was lost" path.
    const blobs = new InMemoryBlobTransfer(new FakeRandomSource());
    const deps: ConnectionDoctorDeps = {
      resolveDelivery: () => new FakeDeliveryPort(),
      render: { renderer: new FakeRenderer(64) },
      blobs,
    };
    const diagnosis = await runConnectionDoctor(deps, 'cloud');
    expect(diagnosis.results.every((r) => !r.ok && r.stage === 'render')).toBe(true);
    expect(diagnosis.results[0]!.message).toContain('lost');
  });

  it('blocks a Private Cloud probe when no server is configured', () => {
    expect(
      troubleshootPrecondition('privatecloud', {
        cloudToken: 'tok',
        privateCloudConfigured: false,
      }),
    ).toContain('Private Cloud');
    expect(
      troubleshootPrecondition('privatecloud', { cloudToken: '', privateCloudConfigured: true }),
    ).toBeUndefined();
  });

  it('blocks a cloud probe when no token is stored', () => {
    expect(
      troubleshootPrecondition('cloud', { cloudToken: '', privateCloudConfigured: false }),
    ).toContain('Supernote Cloud');
    expect(
      troubleshootPrecondition('cloud', { cloudToken: 'tok', privateCloudConfigured: false }),
    ).toBeUndefined();
  });

  it('does not fail a probe when freeing the test blob throws', async () => {
    // releaseBlob is best-effort: a delete that rejects must not fail delivery.
    const throwingBlobs = {
      put: (b: Uint8Array, c: string) => h.blobs.put(b, c),
      get: (handle: string) => h.blobs.get(handle),
      delete: () => Promise.reject(new Error('delete failed')),
    };
    const deps: ConnectionDoctorDeps = {
      resolveDelivery: () => h.port,
      render: { renderer: new FakeRenderer(64, throwingBlobs) },
      blobs: throwingBlobs,
    };
    const diagnosis = await runConnectionDoctor(deps, 'cloud');
    expect(diagnosis.results.every((r) => r.ok)).toBe(true);
  });
});
