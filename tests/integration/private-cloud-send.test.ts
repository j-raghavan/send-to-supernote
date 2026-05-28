/**
 * Integration: Private Cloud selected as the default target (F8-FR4), and the
 * fallback-readiness check — the SAME already-converted blob can be sent to the
 * private adapter that a public send used, with no re-capture (the basis for the
 * F9 public->private fallback).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveDelivery, type ResolveTargetConfig } from '@delivery/resolve-target';
import { PC_APPLY_PATH, PC_FINISH_PATH } from '../../src/delivery/private-cloud-adapter';
import { APPLY_PATH } from '../../src/delivery/public-cloud-adapter';
import { DEFAULT_PUBLIC_PROFILE } from '@domain/delivery';
import type { UploadInput } from '../../src/delivery/delivery-port';
import { FakeHttpClient } from '../fakes/fake-http-client';
import { FakeRandomSource } from '../fakes/fake-random-source';
import { FakeClock } from '../fakes/fake-clock';

const PC_BASE = 'http://192.168.1.5:8080';
const OSS = '/api/oss/upload';

const blob: UploadInput = {
  bytes: new Uint8Array([10, 20, 30, 40]),
  contentType: 'application/pdf',
  directoryId: '778507258773372928',
  fileName: 'A-Web-Article.pdf',
};

function config(http: FakeHttpClient): ResolveTargetConfig {
  return {
    http,
    random: new FakeRandomSource(),
    clock: new FakeClock(1717000000000),
    cloud: { profile: DEFAULT_PUBLIC_PROFILE, token: 'cloud-tok' },
    privateCloud: { baseUrl: PC_BASE, token: 'jwt' },
  };
}

describe('Private Cloud default target (F8-FR4)', () => {
  let http: FakeHttpClient;

  beforeEach(() => {
    http = new FakeHttpClient()
      .on(PC_APPLY_PATH, { status: 200, json: { success: true, uploadUrl: OSS } })
      .on(OSS, { status: 200, json: { success: true } })
      .on(PC_FINISH_PATH, { status: 200, json: { success: true } });
  });

  it('routes a send to the Private Cloud adapter and contacts only the base URL', async () => {
    const port = resolveDelivery('privatecloud', config(http));
    const result = await port.uploadDocument(blob);
    expect(result.ok).toBe(true);
    for (const url of http.urls) {
      expect(new URL(url).host).toBe('192.168.1.5:8080');
    }
  });

  it('reuses the SAME blob across targets (fallback-ready for F9, no re-capture)', async () => {
    // First send to public Cloud fails (non-auth), then the same blob goes to PC.
    const cloudHttp = new FakeHttpClient().on(APPLY_PATH, {
      status: 200,
      json: { success: false, errorMsg: 'cloud endpoint changed' },
    });
    const cloudResult = await resolveDelivery('cloud', config(cloudHttp)).uploadDocument(blob);
    expect(cloudResult.ok).toBe(false);

    // The exact same UploadInput (already-converted blob) is sent to Private Cloud.
    const pcResult = await resolveDelivery('privatecloud', config(http)).uploadDocument(blob);
    expect(pcResult.ok).toBe(true);
    // Same bytes were used — no re-capture/re-render needed.
    expect(blob.bytes).toEqual(new Uint8Array([10, 20, 30, 40]));
  });
});
