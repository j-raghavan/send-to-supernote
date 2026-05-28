import { describe, expect, it } from 'vitest';
import { resolveDelivery, type ResolveTargetConfig } from '@delivery/resolve-target';
import { PublicCloudAdapter } from '@delivery/public-cloud-adapter';
import { PrivateCloudAdapter } from '@delivery/private-cloud-adapter';
import { DEFAULT_PUBLIC_PROFILE } from '@domain/delivery';
import { FakeHttpClient } from '../../fakes/fake-http-client';
import { FakeRandomSource } from '../../fakes/fake-random-source';
import { FakeClock } from '../../fakes/fake-clock';

function config(overrides: Partial<ResolveTargetConfig> = {}): ResolveTargetConfig {
  return {
    http: new FakeHttpClient(),
    random: new FakeRandomSource(),
    clock: new FakeClock(0),
    cloud: { profile: DEFAULT_PUBLIC_PROFILE, token: 'cloud-tok' },
    ...overrides,
  };
}

describe('resolveDelivery target switch (F8 / ADR-0004)', () => {
  it('builds the public adapter for the cloud target', () => {
    expect(resolveDelivery('cloud', config())).toBeInstanceOf(PublicCloudAdapter);
  });

  it('builds the private adapter for the privatecloud target when configured', () => {
    const port = resolveDelivery(
      'privatecloud',
      config({ privateCloud: { baseUrl: 'http://host:8080', token: 'jwt' } }),
    );
    expect(port).toBeInstanceOf(PrivateCloudAdapter);
  });

  it('falls back to the public adapter when privatecloud is selected but not configured', () => {
    expect(resolveDelivery('privatecloud', config())).toBeInstanceOf(PublicCloudAdapter);
  });
});
