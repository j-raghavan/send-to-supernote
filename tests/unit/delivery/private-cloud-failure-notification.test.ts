import { beforeEach, describe, expect, it } from 'vitest';
import { privateCloudFailureNotification } from '@delivery/private-cloud-failure-notification';
import { routeDeliveryFailure } from '@delivery/route-delivery-failure';
import { connectionFailure } from '@domain/delivery';
import { TokenStore } from '@auth/token-store';
import { FakeKeyValueStore } from '../../fakes/fake-key-value-store';
import { FakeNotifier, FakeOptionsOpener } from '../../fakes/fake-notifier';

describe('privateCloudFailureNotification (F8-FR6)', () => {
  it('gives a distinct actionable connection message (not an auth prompt)', () => {
    const note = privateCloudFailureNotification(connectionFailure("can't reach server"));
    expect(note.level).toBe('error');
    expect(note.title).toContain("Can't reach your Private Cloud");
    // The message is shown as-is (the self-contained reachability/cert hint).
    expect(note.message).toBe("can't reach server");
  });

  it('uses a generic send-failed message for a protocol failure', () => {
    const note = privateCloudFailureNotification({ kind: 'protocol', message: 'bad shape' });
    expect(note.title).toBe('Private Cloud send failed');
    expect(note.message).toBe('bad shape');
  });
});

describe('routing a PC connection failure (F8-FR6) — surface, NOT an auth re-prompt', () => {
  let kv: FakeKeyValueStore;
  let tokens: TokenStore;
  let notifier: FakeNotifier;
  let options: FakeOptionsOpener;

  beforeEach(async () => {
    kv = new FakeKeyValueStore();
    tokens = new TokenStore(kv);
    await tokens.save({ token: 'jwt', account: 'me@x.com', equipment: 'eq' });
    notifier = new FakeNotifier();
    options = new FakeOptionsOpener();
  });

  it('a connection failure surfaces and leaves the token intact (no reconnect prompt)', async () => {
    const outcome = await routeDeliveryFailure(connectionFailure('unreachable'), {
      clearToken: () => tokens.clearToken(),
      notifier,
      options,
    });
    expect(outcome.kind).toBe('surface');
    expect(await tokens.getToken()).toBe('jwt');
    expect(options.opens).toHaveLength(0);
  });

  it('an auth failure DOES clear the token and prompt reconnect (contrast)', async () => {
    const outcome = await routeDeliveryFailure(
      { kind: 'auth', errorCode: 'E0401', message: 'x' },
      {
        clearToken: () => tokens.clearToken(),
        notifier,
        options,
      },
    );
    expect(outcome.kind).toBe('auth');
    expect(await tokens.getToken()).toBeUndefined();
  });
});
