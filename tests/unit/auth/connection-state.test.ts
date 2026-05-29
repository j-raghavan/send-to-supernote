import { beforeEach, describe, expect, it } from 'vitest';
import {
  type ReflectDeps,
  reflectConnectionState,
  resolveSessionState,
} from '../../../src/auth/connection-state';
import { TokenStore } from '../../../src/auth/token-store';
import { FakeKeyValueStore } from '../../fakes/fake-key-value-store';
import { FakeBadge } from '../../fakes/fake-badge';

describe('resolveSessionState (F2-FR6)', () => {
  let tokens: TokenStore;

  beforeEach(() => {
    tokens = new TokenStore(new FakeKeyValueStore());
  });

  it('is disconnected when no token is stored', async () => {
    expect(await resolveSessionState(tokens)).toBe('disconnected');
  });

  it('is connected when a token is stored', async () => {
    await tokens.save({ token: 'tok', account: 'a@b.com', equipment: 'eq' });
    expect(await resolveSessionState(tokens)).toBe('connected');
  });

  it('is expired when the expired flag is set (overrides token presence)', async () => {
    await tokens.save({ token: 'tok', account: 'a@b.com', equipment: 'eq' });
    expect(await resolveSessionState(tokens, true)).toBe('expired');
  });

  it('treats an empty-string token as disconnected', async () => {
    await tokens.save({ token: '', account: 'a@b.com', equipment: 'eq' });
    expect(await resolveSessionState(tokens)).toBe('disconnected');
  });
});

describe('reflectConnectionState (F2-FR6)', () => {
  let kv: FakeKeyValueStore;
  let tokens: TokenStore;
  let badge: FakeBadge;
  let deps: ReflectDeps;

  beforeEach(() => {
    kv = new FakeKeyValueStore();
    tokens = new TokenStore(kv);
    badge = new FakeBadge();
    deps = { tokens, badge };
  });

  it('reflects connected + idle on the badge and returns the account', async () => {
    await tokens.save({ token: 'tok', account: 'me@x.com', equipment: 'eq' });
    const view = await reflectConnectionState(deps);
    expect(view.session).toBe('connected');
    expect(view.account).toBe('me@x.com');
    expect(view.badge).toBe('idle');
    expect(badge.current).toBe('idle');
  });

  it('reflects disconnected as the error badge with no account', async () => {
    const view = await reflectConnectionState(deps);
    expect(view.session).toBe('disconnected');
    expect(view.account).toBeUndefined();
    expect(badge.current).toBe('error');
  });

  it('reflects the busy badge while a job is in flight', async () => {
    await tokens.save({ token: 'tok', account: 'me@x.com', equipment: 'eq' });
    const view = await reflectConnectionState(deps, { jobInFlight: true });
    expect(view.badge).toBe('busy');
    expect(badge.current).toBe('busy');
  });

  it('reflects the expired badge after an auth failure', async () => {
    await tokens.save({ token: 'tok', account: 'me@x.com', equipment: 'eq' });
    const view = await reflectConnectionState(deps, { expired: true });
    expect(view.session).toBe('expired');
    expect(badge.current).toBe('expired');
  });
});
