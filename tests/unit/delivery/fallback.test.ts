import { describe, expect, it, vi } from 'vitest';
import { canFallbackToPrivate, offerPrivateCloudFallback } from '@delivery/fallback';
import { ok, err } from '@shared/result';
import type { UploadInput } from '@delivery/delivery-port';
import { FakeDeliveryPort } from '../../fakes/fake-delivery-port';

const blob: UploadInput = {
  bytes: new Uint8Array([1, 2, 3]),
  contentType: 'application/pdf',
  directoryId: '7',
  fileName: 'A.pdf',
};

describe('canFallbackToPrivate (F9-FR2 / R-9)', () => {
  it('allows fallback for a non-auth failure when Private Cloud is configured', () => {
    expect(canFallbackToPrivate({ kind: 'protocol', message: 'x' }, true)).toBe(true);
    expect(canFallbackToPrivate({ kind: 'connection', message: 'x' }, true)).toBe(true);
  });

  it('NEVER falls back for an auth failure (R-9: shared login breaks both)', () => {
    expect(canFallbackToPrivate({ kind: 'auth', message: 'x' }, true)).toBe(false);
  });

  it('does not offer fallback when no Private Cloud is configured', () => {
    expect(canFallbackToPrivate({ kind: 'protocol', message: 'x' }, false)).toBe(false);
  });
});

describe('offerPrivateCloudFallback (F9-FR2)', () => {
  it('declines without sending when the user does not accept', async () => {
    const port = new FakeDeliveryPort();
    const outcome = await offerPrivateCloudFallback(
      { privatePort: () => port, offer: () => Promise.resolve(false) },
      blob,
    );
    expect(outcome.kind).toBe('declined');
    expect(port.uploadCalls).toHaveLength(0);
  });

  it('re-sends the SAME blob to Private Cloud when accepted (no re-capture)', async () => {
    const port = new FakeDeliveryPort();
    port.uploadResult = ok({ fileName: 'A.pdf', innerName: 'inner' });
    const offer = vi.fn().mockResolvedValue(true);
    const outcome = await offerPrivateCloudFallback({ privatePort: () => port, offer }, blob);
    expect(outcome.kind).toBe('sent');
    expect(port.uploadCalls).toHaveLength(1);
    expect(Array.from(port.uploadCalls[0]!.bytes)).toEqual([1, 2, 3]);
  });

  it('reports a failure when the Private Cloud send also fails', async () => {
    const port = new FakeDeliveryPort();
    port.uploadResult = err({ kind: 'connection', message: 'unreachable' });
    const outcome = await offerPrivateCloudFallback(
      { privatePort: () => port, offer: () => Promise.resolve(true) },
      blob,
    );
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.failure.kind).toBe('connection');
    }
  });
});
