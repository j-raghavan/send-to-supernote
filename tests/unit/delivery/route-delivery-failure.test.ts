import { beforeEach, describe, expect, it } from 'vitest';
import { routeDeliveryFailure } from '../../../src/delivery/route-delivery-failure';
import type { AuthFailureDeps } from '../../../src/auth/handle-auth-failure';
import { TokenStore } from '../../../src/auth/token-store';
import { FakeKeyValueStore } from '../../fakes/fake-key-value-store';
import { FakeNotifier, FakeOptionsOpener } from '../../fakes/fake-notifier';

describe('routeDeliveryFailure (F5-FR4)', () => {
  let kv: FakeKeyValueStore;
  let tokens: TokenStore;
  let notifier: FakeNotifier;
  let options: FakeOptionsOpener;
  let authDeps: AuthFailureDeps;

  beforeEach(async () => {
    kv = new FakeKeyValueStore();
    tokens = new TokenStore(kv);
    await tokens.save({ token: 'tok', account: 'me@x.com', equipment: 'eq' });
    notifier = new FakeNotifier();
    options = new FakeOptionsOpener();
    authDeps = { clearToken: () => tokens.clearToken(), notifier, options };
  });

  it('routes an auth failure to the recovery and reports the job retained', async () => {
    const outcome = await routeDeliveryFailure(
      { kind: 'auth', errorCode: 'E0401', message: 'expired' },
      authDeps,
      { account: 'me@x.com' },
    );
    expect(outcome.kind).toBe('auth');
    if (outcome.kind === 'auth') {
      expect(outcome.retainedForRetry).toBe(true);
    }
    expect(await tokens.getToken()).toBeUndefined();
    expect(notifier.notifications[0]?.title).toContain('session expired');
    expect(options.opens).toEqual(['me@x.com']);
  });

  it('surfaces a protocol failure without touching the token', async () => {
    const outcome = await routeDeliveryFailure(
      { kind: 'protocol', message: 'apply returned a bad shape' },
      authDeps,
    );
    expect(outcome.kind).toBe('surface');
    if (outcome.kind === 'surface') {
      expect(outcome.failure.message).toBe('apply returned a bad shape');
    }
    expect(await tokens.getToken()).toBe('tok');
    expect(notifier.notifications).toHaveLength(0);
  });

  it('surfaces a connection failure for the caller to handle (F9 fallback)', async () => {
    const outcome = await routeDeliveryFailure(
      { kind: 'connection', message: 'unreachable' },
      authDeps,
    );
    expect(outcome.kind).toBe('surface');
  });
});
