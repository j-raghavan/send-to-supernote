import { beforeEach, describe, expect, it } from 'vitest';
import { retryPending, type RetryDeps } from '@jobs/retry-pending';
import { JobQueue } from '@jobs/job-queue';
import { err, ok } from '@shared/result';
import { InMemoryBlobTransfer } from '../../../src/background/in-memory-blob-transfer';
import { FakeDeliveryPort } from '../../fakes/fake-delivery-port';
import { FakeKeyValueStore } from '../../fakes/fake-key-value-store';
import { FakeClock } from '../../fakes/fake-clock';
import { FakeRandomSource } from '../../fakes/fake-random-source';

describe('retryPending (F9-FR1)', () => {
  let kv: FakeKeyValueStore;
  let queue: JobQueue;
  let blobs: InMemoryBlobTransfer;
  let port: FakeDeliveryPort;
  let deps: RetryDeps;

  beforeEach(() => {
    kv = new FakeKeyValueStore();
    queue = new JobQueue(kv, new FakeClock(1000));
    blobs = new InMemoryBlobTransfer(new FakeRandomSource());
    port = new FakeDeliveryPort();
    deps = { queue, blobs, resolveDelivery: () => port };
  });

  async function enqueueWithBlob(id: string): Promise<string> {
    const handle = await blobs.put(new Uint8Array([1, 2, 3]), 'application/pdf');
    await queue.enqueue({
      id,
      target: 'cloud',
      directoryId: '7',
      fileName: `${id}.pdf`,
      contentType: 'application/pdf',
      blobHandle: handle,
    });
    return handle;
  }

  it('retries a retained job after reconnect, reusing the converted blob (no re-capture)', async () => {
    await enqueueWithBlob('a');
    const outcome = await retryPending(deps, 'cloud');
    expect(outcome).toEqual({ retried: 1, succeeded: 1, failed: 0 });
    expect(port.uploadCalls).toHaveLength(1);
    expect(port.uploadCalls[0]!.fileName).toBe('a.pdf');
    // the bytes came from the stored blob (no extractor/renderer involved)
    expect(Array.from(port.uploadCalls[0]!.bytes)).toEqual([1, 2, 3]);
    // removed on success
    expect(await queue.list()).toHaveLength(0);
  });

  it('keeps a job retained when the retry still fails (e.g. auth not yet fixed)', async () => {
    await enqueueWithBlob('b');
    port.uploadResult = err({ kind: 'auth', errorCode: 'E0401', message: 'still expired' });
    const outcome = await retryPending(deps, 'cloud');
    expect(outcome).toEqual({ retried: 1, succeeded: 0, failed: 1 });
    expect(await queue.list()).toHaveLength(1);
  });

  it('frees the blob after a successful retry', async () => {
    const handle = await enqueueWithBlob('c');
    await retryPending(deps, 'cloud');
    expect(await blobs.get(handle)).toBeUndefined();
  });

  it('drops an un-resumable job whose blob was pruned', async () => {
    await queue.enqueue({
      id: 'gone',
      target: 'cloud',
      directoryId: '7',
      fileName: 'gone.pdf',
      contentType: 'application/pdf',
      blobHandle: 'missing-handle',
    });
    const outcome = await retryPending(deps, 'cloud');
    expect(outcome.failed).toBe(1);
    expect(port.uploadCalls).toHaveLength(0);
    expect(await queue.list()).toHaveLength(0);
  });

  it('only retries jobs for the reconnected target', async () => {
    await enqueueWithBlob('cloud-job');
    const pcHandle = await blobs.put(new Uint8Array([9]), 'application/pdf');
    await queue.enqueue({
      id: 'pc-job',
      target: 'privatecloud',
      directoryId: '7',
      fileName: 'pc.pdf',
      contentType: 'application/pdf',
      blobHandle: pcHandle,
    });
    port.uploadResult = ok({ fileName: 'x', innerName: 'x' });
    const outcome = await retryPending(deps, 'cloud');
    expect(outcome.retried).toBe(1);
    // pc job remains
    expect(await queue.forTarget('privatecloud')).toHaveLength(1);
  });
});
