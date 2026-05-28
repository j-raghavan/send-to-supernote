import { beforeEach, describe, expect, it } from 'vitest';
import { looksLikeEndpointChange, runHealthCheck } from '@jobs/health-check';
import { ok, err } from '@shared/result';
import { FakeDeliveryPort } from '../../fakes/fake-delivery-port';

describe('looksLikeEndpointChange (F9-FR3)', () => {
  it('is true for non-auth failures (protocol/connection/not-found)', () => {
    expect(looksLikeEndpointChange({ kind: 'protocol', message: 'x' })).toBe(true);
    expect(looksLikeEndpointChange({ kind: 'connection', message: 'x' })).toBe(true);
    expect(looksLikeEndpointChange({ kind: 'not-found', message: 'x' })).toBe(true);
  });

  it('is false for an auth failure (just re-login, not an endpoint break)', () => {
    expect(looksLikeEndpointChange({ kind: 'auth', message: 'x' })).toBe(false);
  });
});

describe('runHealthCheck (F9-FR3)', () => {
  let port: FakeDeliveryPort;

  beforeEach(() => {
    port = new FakeDeliveryPort();
  });

  it('reports healthy when the check succeeds', async () => {
    port.healthResult = ok(undefined);
    const result = await runHealthCheck({ port, privateCloudConfigured: true }, 'cloud');
    expect(result).toEqual({ healthy: true, recommendPrivateCloud: false });
  });

  it('recommends Private Cloud when the PUBLIC check fails with an endpoint-change-like error and PC is configured', async () => {
    port.healthResult = err({ kind: 'protocol', message: 'endpoint changed' });
    const result = await runHealthCheck({ port, privateCloudConfigured: true }, 'cloud');
    expect(result.healthy).toBe(false);
    expect(result.recommendPrivateCloud).toBe(true);
    expect(result.failure?.kind).toBe('protocol');
  });

  it('does NOT recommend Private Cloud when none is configured (R-9 self-hoster only)', async () => {
    port.healthResult = err({ kind: 'protocol', message: 'endpoint changed' });
    const result = await runHealthCheck({ port, privateCloudConfigured: false }, 'cloud');
    expect(result.recommendPrivateCloud).toBe(false);
  });

  it('does NOT recommend a switch for an auth failure (just re-login)', async () => {
    port.healthResult = err({ kind: 'auth', message: 'expired' });
    const result = await runHealthCheck({ port, privateCloudConfigured: true }, 'cloud');
    expect(result.recommendPrivateCloud).toBe(false);
  });

  it('does NOT recommend a switch when the PRIVATE check itself fails', async () => {
    port.healthResult = err({ kind: 'connection', message: 'unreachable' });
    const result = await runHealthCheck({ port, privateCloudConfigured: true }, 'privatecloud');
    expect(result.recommendPrivateCloud).toBe(false);
  });
});
