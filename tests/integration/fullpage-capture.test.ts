/**
 * Full Page capture → send end-to-end flow (FP7-FR2, IP-3).
 *
 * The saga's Full Page branch (Batch F) consumes the HIGH-LEVEL, already
 * target-agnostic `fullpage.capture` + `stitcher` collaborators: composition
 * pre-binds the active tab/target/driver/clock/sleep, so the covered saga only
 * hands the page size in and consumes the `Result`. This file wires `sendDocument`
 * with the real `InMemoryBlobTransfer`, a recorder `FakeDeliveryPort`, and the
 * `deps.fullpage` fakes, and asserts the genuine end-to-end Full Page flow:
 *
 *   capture (tiles + geometry) → stitch (→ application/pdf blob handle)
 *   → upload the PDF to the Supernote target ONLY (no third party — IP-3).
 *
 * "Both targets" (Chrome offscreen-dispatch stitcher vs Firefox DirectStitcher)
 * is simulated by parameterizing the stitcher arm: each arm's output is an
 * uploadable image-based PDF, which is all the saga sees. The actual __TARGET__
 * adapter selection (offscreen vs direct) is composition glue — c8-ignored and
 * covered by the Firefox-bundle audit (tests/integration/firefox-bundle-audit.test.ts);
 * we deliberately do NOT drive real composition here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type SendDocumentDeps, type SendRequest, sendDocument } from '@jobs/send-document';
import { ok } from '@shared/result';
import type { Result } from '@shared/result';
import type { Target } from '@domain/settings';
import type { StitchGeometry, TileRef } from '@conversion/fullpage-stitch-core';
import type { PageSize } from '@domain/conversion';
import type { FullPageError, FullPageResult } from '@capture/capture-fullpage';
import { TokenStore } from '@auth/token-store';
import { InMemoryBlobTransfer } from '../../src/background/in-memory-blob-transfer';
import { FakeExtractor } from '../fakes/fake-extractor';
import { FakeRenderer } from '../fakes/fake-renderer';
import { FakeDeliveryPort } from '../fakes/fake-delivery-port';
import { FakeNotifier, FakeOptionsOpener } from '../fakes/fake-notifier';
import { FakeBadge } from '../fakes/fake-badge';
import { FakeClock } from '../fakes/fake-clock';
import { FakeKeyValueStore } from '../fakes/fake-key-value-store';
import { FakeRandomSource } from '../fakes/fake-random-source';

const GEOMETRY: StitchGeometry = {
  totalHeight: 4000,
  viewportHeight: 800,
  width: 1280,
  dpr: 2,
  pageSize: 'a4',
};

const req = (overrides: Partial<SendRequest> = {}): SendRequest => ({
  mode: 'fullpage',
  format: 'pdf',
  target: 'cloud',
  confirmFilename: false,
  includeImages: true,
  page: { hostname: 'example.com' },
  ...overrides,
});

interface Harness {
  deps: SendDocumentDeps;
  port: FakeDeliveryPort;
  notifier: FakeNotifier;
  badge: FakeBadge;
  blobs: InMemoryBlobTransfer;
}

async function harness(): Promise<Harness> {
  const kv = new FakeKeyValueStore();
  const tokens = new TokenStore(kv);
  await tokens.save({ token: 'tok', account: 'me@x.com', equipment: 'eq' });
  const port = new FakeDeliveryPort();
  const notifier = new FakeNotifier();
  const badge = new FakeBadge();
  const blobs = new InMemoryBlobTransfer(new FakeRandomSource());
  const options = new FakeOptionsOpener();
  const deps: SendDocumentDeps = {
    resolveDelivery: () => port,
    capture: { extractor: new FakeExtractor({ title: 'X', content: '', length: 0 }) },
    render: { renderer: new FakeRenderer(2048, blobs) },
    blobs,
    notifier,
    badge,
    clock: new FakeClock(Date.UTC(2026, 4, 28)),
    hasToken: async (_t: Target) => (await tokens.getToken()) !== undefined,
    account: 'me@x.com',
    authDeps: { clearToken: () => tokens.clearToken(), notifier, options },
  };
  return { deps, port, notifier, badge, blobs };
}

type Fullpage = NonNullable<SendDocumentDeps['fullpage']>;

describe('Full Page capture → send end-to-end (FP7-FR2)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await harness();
  });

  // Both stitcher arms (Chrome offscreen-dispatch vs Firefox DirectStitcher)
  // surface the same high-level contract to the saga: a stored, uploadable PDF.
  describe.each<{ arm: string }>([
    { arm: 'chrome (offscreen-dispatch)' },
    { arm: 'firefox (direct)' },
  ])('via the $arm stitcher arm', () => {
    it('captures, stitches a PDF, and uploads it to the Supernote target ONLY (IP-3)', async () => {
      const tileHandle = await h.blobs.put(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png');
      const capture = vi.fn(
        (_pageSize: PageSize): Promise<Result<FullPageResult, FullPageError>> =>
          Promise.resolve(
            ok({
              tiles: [{ handle: tileHandle, offsetY: 0 }],
              geometry: GEOMETRY,
              truncated: false,
            }),
          ),
      );
      const stitch = vi.fn(async (_tiles: TileRef[], _geom: StitchGeometry) => {
        const handle = await h.blobs.put(new Uint8Array([1, 2, 3]), 'application/pdf');
        return { handle, contentType: 'application/pdf', size: 3 };
      });
      const fullpage: Fullpage = { capture, stitcher: { stitch } };
      h.deps.fullpage = fullpage;

      const result = await sendDocument(h.deps, req());

      // The end-to-end flow reached done.
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.state).toBe('done');

      // capture → stitch ran with the default page size and captured geometry.
      expect(capture).toHaveBeenCalledWith('a4');
      expect(stitch).toHaveBeenCalledOnce();
      expect(stitch.mock.calls[0]![1]).toEqual(GEOMETRY);

      // Exactly one PDF uploaded — to the resolved Supernote delivery port only.
      expect(h.port.uploadCalls).toHaveLength(1);
      expect(h.port.uploadCalls[0]!.contentType).toBe('application/pdf');
      // Empty title → <hostname>-<date> fallback filename (FakeClock-driven).
      expect(h.port.uploadCalls[0]!.fileName).toBe('example.com-2026-05-28.pdf');

      // IP-3: no third party — the saga uploads solely through resolveDelivery.
      // (The single FakeDeliveryPort is the only destination wired here.)
      expect(h.badge.current).toBe('idle');

      // The per-tile PNG was freed after stitching (no leaked blobs).
      expect(await h.blobs.get(tileHandle)).toBeUndefined();
    });
  });
});
