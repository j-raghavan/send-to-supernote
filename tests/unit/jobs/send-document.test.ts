import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type SendDocumentDeps, type SendRequest, sendDocument } from '@jobs/send-document';
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

interface Harness {
  deps: SendDocumentDeps;
  port: FakeDeliveryPort;
  notifier: FakeNotifier;
  badge: FakeBadge;
  blobs: InMemoryBlobTransfer;
  tokens: TokenStore;
  options: FakeOptionsOpener;
}

const ARTICLE = {
  title: 'My Article',
  content: '<h1>My Article</h1><p>'.padEnd(120, 'x') + '</p>',
  length: 800,
};

const req = (overrides: Partial<SendRequest> = {}): SendRequest => ({
  mode: 'reader',
  format: 'pdf',
  target: 'cloud',
  confirmFilename: false,
  page: { hostname: 'example.com' },
  ...overrides,
});

async function harness(opts: { connected?: boolean } = {}): Promise<Harness> {
  const kv = new FakeKeyValueStore();
  const tokens = new TokenStore(kv);
  if (opts.connected !== false) {
    await tokens.save({ token: 'tok', account: 'me@x.com', equipment: 'eq' });
  }
  const port = new FakeDeliveryPort();
  const notifier = new FakeNotifier();
  const badge = new FakeBadge();
  const blobs = new InMemoryBlobTransfer(new FakeRandomSource());
  const options = new FakeOptionsOpener();
  const deps: SendDocumentDeps = {
    resolveDelivery: () => port,
    capture: {
      extractor: new FakeExtractor(ARTICLE, {
        title: 'My Article',
        html: '<html><body>x</body></html>',
      }),
    },
    render: { renderer: new FakeRenderer(2048, blobs) },
    blobs,
    notifier,
    badge,
    clock: new FakeClock(Date.UTC(2026, 4, 28)),
    hasToken: async (_t: Target) => (await tokens.getToken()) !== undefined,
    account: 'me@x.com',
    authDeps: {
      clearToken: () => tokens.clearToken(),
      notifier,
      options,
    },
  };
  return { deps, port, notifier, badge, blobs, tokens, options };
}

describe('sendDocument saga (F6-FR1, drives the job FSM)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await harness();
  });

  it('runs capture -> render -> upload -> finish and reaches done (I-3)', async () => {
    const result = await sendDocument(h.deps, req());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state).toBe('done');
    }
    expect(h.port.uploadCalls).toHaveLength(1);
    expect(h.port.uploadCalls[0]!.contentType).toBe('application/pdf');
  });

  it('emits progress notifications then a success toast, and ends idle', async () => {
    await sendDocument(h.deps, req());
    const titles = h.notifier.notifications.map((n) => n.title);
    expect(titles).toContain('Capturing');
    expect(titles).toContain('Converting');
    expect(titles).toContain('Uploading');
    expect(titles[titles.length - 1]).toBe('Sent to Supernote');
    expect(h.notifier.notifications.at(-1)?.message).toContain('sync your device');
    // busy while in flight, idle at the end (F6-FR5)
    expect(h.badge.states[0]).toBe('busy');
    expect(h.badge.current).toBe('idle');
  });

  it('prompts to connect and aborts when there is no token (F6-AC6)', async () => {
    const disconnected = await harness({ connected: false });
    const result = await sendDocument(disconnected.deps, req());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('not-connected');
    }
    expect(disconnected.notifier.notifications[0]?.title).toBe('Connect first');
    expect(disconnected.badge.current).toBe('error');
    expect(disconnected.port.uploadCalls).toHaveLength(0);
  });

  it('captures Full Page when the request mode is fullpage', async () => {
    const result = await sendDocument(h.deps, req({ mode: 'fullpage' }));
    expect(result.ok).toBe(true);
  });

  it('surfaces "try Full Page" and aborts on an empty reader extraction (F3-FR5)', async () => {
    h.deps.capture = { extractor: new FakeExtractor({ title: 'T', content: '', length: 0 }) };
    const result = await sendDocument(h.deps, req());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('capture');
    }
    expect(h.notifier.notifications.some((n) => n.message.includes('Full Page'))).toBe(true);
    expect(h.badge.current).toBe('error');
  });

  it('fails on a render error (no upload attempted)', async () => {
    const renderer = new FakeRenderer();
    renderer.failNext = 2;
    h.deps.render = { renderer };
    const result = await sendDocument(h.deps, req());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('render');
    }
    expect(h.port.uploadCalls).toHaveLength(0);
  });

  it('fails if the rendered blob handle cannot be resolved', async () => {
    // A renderer that returns a handle the blob store does not know about.
    h.deps.render = {
      renderer: {
        render: () => Promise.resolve({ handle: 'ghost', contentType: 'application/pdf', size: 1 }),
      },
    };
    const result = await sendDocument(h.deps, req());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('render');
      expect(result.error.message).toContain('missing');
    }
  });

  it('resolves the Document/ folder and de-dupes against its real listing (F6-FR3/c)', async () => {
    h.port.foldersByDirectory.set('0', ok([{ id: 'doc-7', name: 'Document', isFolder: true }]));
    h.port.foldersByDirectory.set(
      'doc-7',
      ok([{ id: '99', name: 'My-Article.pdf', isFolder: false }]),
    );
    await sendDocument(h.deps, req());
    expect(h.port.uploadCalls[0]!.directoryId).toBe('doc-7');
    expect(h.port.uploadCalls[0]!.fileName).toBe('My-Article-2.pdf');
  });

  it('uses an explicit folder id when provided (no Document lookup)', async () => {
    await sendDocument(h.deps, req({ folderId: 'chosen-5' }));
    expect(h.port.uploadCalls[0]!.directoryId).toBe('chosen-5');
    expect(h.port.listCalls).not.toContain('0');
  });

  it('falls back to root when no Document folder exists', async () => {
    h.port.foldersByDirectory.set('0', ok([{ id: '1', name: 'Other', isFolder: true }]));
    await sendDocument(h.deps, req());
    expect(h.port.uploadCalls[0]!.directoryId).toBe('0');
  });

  it('falls back to root when the root listing fails during destination resolution', async () => {
    h.port.foldersByDirectory.set('0', err({ kind: 'protocol', message: 'list down' }));
    await sendDocument(h.deps, req());
    expect(h.port.uploadCalls[0]!.directoryId).toBe('0');
  });

  it('still builds a filename when the destination listing fails (no dedup data)', async () => {
    h.port.foldersByDirectory.set('0', ok([{ id: 'doc-7', name: 'Document', isFolder: true }]));
    h.port.foldersByDirectory.set('doc-7', err({ kind: 'protocol', message: 'list down' }));
    const result = await sendDocument(h.deps, req());
    expect(result.ok).toBe(true);
    expect(h.port.uploadCalls[0]!.fileName).toBe('My-Article.pdf');
  });

  it('honors the confirmFilename hook to edit the name before upload (F6-FR4)', async () => {
    const confirmName = vi.fn().mockResolvedValue('Edited-Name.pdf');
    h.deps.confirmName = confirmName;
    await sendDocument(h.deps, req({ confirmFilename: true }));
    expect(confirmName).toHaveBeenCalledOnce();
    expect(h.port.uploadCalls[0]!.fileName).toBe('Edited-Name.pdf');
  });

  it('does not prompt when confirmFilename is false', async () => {
    const confirmName = vi.fn();
    h.deps.confirmName = confirmName;
    await sendDocument(h.deps, req({ confirmFilename: false }));
    expect(confirmName).not.toHaveBeenCalled();
  });

  it('routes an auth failure to recovery, sets the expired badge, retains for retry', async () => {
    h.port.uploadResult = err({ kind: 'auth', errorCode: 'E0401', message: 'expired' });
    const result = await sendDocument(h.deps, req());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('auth');
    }
    expect(await h.tokens.getToken()).toBeUndefined();
    expect(h.badge.current).toBe('expired');
    // F2-FR4/F2-AC4: Options re-opens with the connected email prefilled.
    expect(h.options.opens).toEqual(['me@x.com']);
  });

  it('labels the auth re-prompt "Private Cloud" when targeting Private Cloud (F8 reuse)', async () => {
    h.port.uploadResult = err({ kind: 'auth', errorCode: 'E0401', message: 'expired' });
    await sendDocument(h.deps, req({ target: 'privatecloud' }));
    expect(h.notifier.notifications.some((n) => n.title.includes('Private Cloud'))).toBe(true);
  });

  it('opens Options without a prefill when no account is known', async () => {
    const deps = { ...h.deps };
    delete deps.account;
    h.port.uploadResult = err({ kind: 'auth', errorCode: 'E0401', message: 'expired' });
    await sendDocument(deps, req());
    expect(h.options.opens).toEqual([undefined]);
  });

  it('surfaces a non-auth delivery failure with the failure attached (feeds F9)', async () => {
    h.port.uploadResult = err({ kind: 'protocol', message: 'bad apply shape' });
    const result = await sendDocument(h.deps, req());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('delivery');
      expect(result.error.failure?.kind).toBe('protocol');
    }
    expect(h.badge.current).toBe('error');
  });

  it('offers the Private Cloud fallback on a non-auth public failure and sends the SAME blob (F9-FR2)', async () => {
    h.port.uploadResult = err({ kind: 'protocol', message: 'cloud endpoint changed' });
    const pcPort = new FakeDeliveryPort();
    pcPort.uploadResult = ok({ fileName: 'My-Article.pdf', innerName: 'inner' });
    h.deps.fallback = { privatePort: () => pcPort, offer: () => Promise.resolve(true) };

    const result = await sendDocument(h.deps, req());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state).toBe('done');
    }
    // The already-converted blob was re-sent to the PC adapter (no re-capture).
    expect(pcPort.uploadCalls).toHaveLength(1);
    expect(h.badge.current).toBe('idle');
  });

  it('surfaces the failure when the user declines the Private Cloud fallback', async () => {
    h.port.uploadResult = err({ kind: 'protocol', message: 'cloud endpoint changed' });
    const pcPort = new FakeDeliveryPort();
    h.deps.fallback = { privatePort: () => pcPort, offer: () => Promise.resolve(false) };

    const result = await sendDocument(h.deps, req());

    expect(result.ok).toBe(false);
    expect(pcPort.uploadCalls).toHaveLength(0);
    expect(h.badge.current).toBe('error');
  });

  it('does NOT offer the fallback for an auth failure (R-9: shared login)', async () => {
    h.port.uploadResult = err({ kind: 'auth', errorCode: 'E0401', message: 'expired' });
    const pcPort = new FakeDeliveryPort();
    const offer = vi.fn().mockResolvedValue(true);
    h.deps.fallback = { privatePort: () => pcPort, offer };

    await sendDocument(h.deps, req());

    expect(offer).not.toHaveBeenCalled();
    expect(pcPort.uploadCalls).toHaveLength(0);
    expect(h.badge.current).toBe('expired');
  });

  it('deletes the rendered blob after a successful finish (cleanup)', async () => {
    await sendDocument(h.deps, req());
    // The FakeRenderer stored bytes under the first deterministic UUID handle;
    // after a successful finish it must be cleaned up.
    const remaining = await h.blobs.get('00000000-0000-0000-0000-000000000001');
    expect(remaining).toBeUndefined();
  });
});
