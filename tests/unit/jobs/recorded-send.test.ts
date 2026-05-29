import { beforeEach, describe, expect, it } from 'vitest';
import { recordedSend } from '@jobs/recorded-send';
import { JobHistory } from '@jobs/job-history';
import type { SendDocumentDeps, SendRequest } from '@jobs/send-document';
import { ok, err } from '@shared/result';
import type { Target } from '@domain/settings';
import { TokenStore } from '@auth/token-store';
import { InMemoryBlobTransfer } from '../../../src/background/in-memory-blob-transfer';
import { FakeExtractor } from '../../fakes/fake-extractor';
import { FakeRenderer } from '../../fakes/fake-renderer';
import { FakeDeliveryPort } from '../../fakes/fake-delivery-port';
import { FakeNotifier, FakeOptionsOpener } from '../../fakes/fake-notifier';
import { FakeBadge } from '../../fakes/fake-badge';
import { FakeClock } from '../../fakes/fake-clock';
import { FakeKeyValueStore } from '../../fakes/fake-key-value-store';
import { FakeRandomSource } from '../../fakes/fake-random-source';

const req: SendRequest = {
  mode: 'reader',
  format: 'pdf',
  target: 'cloud',
  confirmFilename: false,
  page: { hostname: 'example.com' },
};

describe('recordedSend (F6-FR6 / F9 history)', () => {
  let kv: FakeKeyValueStore;
  let history: JobHistory;
  let port: FakeDeliveryPort;
  let deps: SendDocumentDeps;

  beforeEach(async () => {
    kv = new FakeKeyValueStore();
    history = new JobHistory(kv, new FakeClock(1000));
    const tokens = new TokenStore(kv);
    await tokens.save({ token: 'tok', account: 'me@x.com', equipment: 'eq' });
    port = new FakeDeliveryPort();
    const blobs = new InMemoryBlobTransfer(new FakeRandomSource());
    deps = {
      resolveDelivery: () => port,
      capture: {
        extractor: new FakeExtractor({
          title: 'My Article',
          content: '<p>'.padEnd(80, 'x') + '</p>',
          length: 600,
        }),
      },
      render: { renderer: new FakeRenderer(1024, blobs) },
      blobs,
      notifier: new FakeNotifier(),
      badge: new FakeBadge(),
      clock: new FakeClock(1000),
      hasToken: async (_t: Target) => (await tokens.getToken()) !== undefined,
      authDeps: {
        clearToken: () => tokens.clearToken(),
        notifier: new FakeNotifier(),
        options: new FakeOptionsOpener(),
      },
    };
  });

  it('records a done outcome with the uploaded filename on success', async () => {
    port.uploadResult = ok({ fileName: 'My-Article.pdf', innerName: 'inner' });
    const result = await recordedSend(history, deps, req);
    expect(result.ok).toBe(true);
    const entries = await history.list();
    expect(entries[0]!.outcome).toBe('done');
    expect(entries[0]!.fileName).toBe('My-Article.pdf');
  });

  it('records a failed outcome with the reason on failure', async () => {
    port.uploadResult = err({ kind: 'protocol', message: 'apply broke' });
    const result = await recordedSend(history, deps, req);
    expect(result.ok).toBe(false);
    const entries = await history.list();
    expect(entries[0]!.outcome).toBe('failed');
    expect(entries[0]!.reason).toBe('apply broke');
  });
});
