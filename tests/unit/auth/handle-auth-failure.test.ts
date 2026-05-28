import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuthFailureDeps, handleAuthFailure } from '../../../src/auth/handle-auth-failure';
import { TokenStore } from '../../../src/auth/token-store';
import { FakeKeyValueStore } from '../../fakes/fake-key-value-store';
import { FakeNotifier, FakeOptionsOpener } from '../../fakes/fake-notifier';

describe('handleAuthFailure (F2-FR4 / F2-AC4)', () => {
  let kv: FakeKeyValueStore;
  let tokens: TokenStore;
  let notifier: FakeNotifier;
  let options: FakeOptionsOpener;
  let deps: AuthFailureDeps;

  beforeEach(async () => {
    kv = new FakeKeyValueStore();
    tokens = new TokenStore(kv);
    await tokens.save({ token: 'tok', account: 'me@x.com', equipment: 'eq' });
    notifier = new FakeNotifier();
    options = new FakeOptionsOpener();
    deps = {
      clearToken: () => tokens.clearToken(),
      notifier,
      options,
    };
  });

  it('clears the token, notifies, opens Options prefilled, and reports expired', async () => {
    const state = await handleAuthFailure(deps, { account: 'me@x.com' });

    expect(state).toBe('expired');
    expect(await tokens.getToken()).toBeUndefined();
    expect(notifier.notifications[0]?.level).toBe('error');
    expect(notifier.notifications[0]?.title).toContain('session expired');
    expect(options.opens).toEqual(['me@x.com']);
  });

  it('keeps the account/equipment so the re-connect form can prefill (no password stored)', async () => {
    await handleAuthFailure(deps, { account: 'me@x.com' });
    expect(await tokens.getAccount()).toBe('me@x.com');
    expect(kv.snapshot()).not.toContain('password');
  });

  it('retains the interrupted job when a retainJob hook is provided (F9-FR1)', async () => {
    const retainJob = vi.fn().mockResolvedValue(undefined);
    await handleAuthFailure({ ...deps, retainJob }, { account: 'me@x.com' });
    expect(retainJob).toHaveBeenCalledOnce();
  });

  it('uses a custom target label and tolerates a missing account', async () => {
    await handleAuthFailure(deps, { targetLabel: 'Private Cloud' });
    expect(notifier.notifications[0]?.title).toContain('Private Cloud');
    expect(options.opens).toEqual([undefined]);
  });

  it('defaults to the Supernote label and no prefill when no params are given', async () => {
    await handleAuthFailure(deps);
    expect(notifier.notifications[0]?.title).toBe('Supernote session expired');
    expect(options.opens).toEqual([undefined]);
  });
});
