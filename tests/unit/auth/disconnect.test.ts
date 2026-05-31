import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  disconnect,
  disconnectPrivateCloud,
  disconnectPublicCloud,
} from '../../../src/auth/disconnect';
import { TokenStore } from '../../../src/auth/token-store';
import { StorageKeys } from '@shared/storage-keys';
import { FakeKeyValueStore } from '../../fakes/fake-key-value-store';

describe('disconnect (F2-FR5 / F2-AC5)', () => {
  let kv: FakeKeyValueStore;
  let tokens: TokenStore;

  beforeEach(async () => {
    kv = new FakeKeyValueStore();
    tokens = new TokenStore(kv);
    await tokens.save({ token: 'tok', account: 'me@x.com', equipment: 'eq' });
  });

  it('removes the public Cloud token, account, and equipment', async () => {
    await disconnectPublicCloud({ store: kv });
    expect(await kv.get(StorageKeys.token)).toBeUndefined();
    expect(await kv.get(StorageKeys.account)).toBeUndefined();
    expect(await kv.get(StorageKeys.equipment)).toBeUndefined();
  });

  it('clears any in-progress connect state (tab id + cookie store)', async () => {
    await kv.set(StorageKeys.cloudConnectTabId, 42);
    await kv.set(StorageKeys.cloudConnectStoreId, 'firefox-private');
    await disconnectPublicCloud({ store: kv });
    expect(await kv.get(StorageKeys.cloudConnectTabId)).toBeUndefined();
    expect(await kv.get(StorageKeys.cloudConnectStoreId)).toBeUndefined();
  });

  it('leaves unrelated keys untouched', async () => {
    await kv.set(StorageKeys.defaultMode, 'reader');
    await disconnectPublicCloud({ store: kv });
    expect(await kv.get(StorageKeys.defaultMode)).toBe('reader');
  });

  it('clears pending jobs via the hook when provided', async () => {
    const clearPendingJobs = vi.fn().mockResolvedValue(undefined);
    await disconnectPublicCloud({ store: kv, clearPendingJobs });
    expect(clearPendingJobs).toHaveBeenCalledOnce();
  });

  it('removes exactly the supplied key set (target-agnostic)', async () => {
    await kv.set(StorageKeys.privateToken, 'jwt');
    await disconnect({ store: kv }, [StorageKeys.privateToken]);
    expect(await kv.get(StorageKeys.privateToken)).toBeUndefined();
    // public token untouched because it was not in the supplied set
    expect(await kv.get(StorageKeys.token)).toBe('tok');
  });
});

describe('disconnectPrivateCloud (F8-FR5)', () => {
  let kv: FakeKeyValueStore;

  beforeEach(async () => {
    kv = new FakeKeyValueStore();
    await kv.set(StorageKeys.privateToken, 'jwt');
    await kv.set(StorageKeys.privateAccount, 'me@x.com');
    await kv.set(StorageKeys.privateBaseUrl, 'http://host:8080');
  });

  it('removes the JWT and account', async () => {
    await disconnectPrivateCloud({ store: kv });
    expect(await kv.get(StorageKeys.privateToken)).toBeUndefined();
    expect(await kv.get(StorageKeys.privateAccount)).toBeUndefined();
  });

  it('keeps the base URL so the re-connect form can prefill it', async () => {
    await disconnectPrivateCloud({ store: kv });
    expect(await kv.get(StorageKeys.privateBaseUrl)).toBe('http://host:8080');
  });

  it('clears PC pending jobs via the hook', async () => {
    const clearPendingJobs = vi.fn().mockResolvedValue(undefined);
    await disconnectPrivateCloud({ store: kv, clearPendingJobs });
    expect(clearPendingJobs).toHaveBeenCalledOnce();
  });

  it('leaves the public Cloud token untouched', async () => {
    await kv.set(StorageKeys.token, 'public-tok');
    await disconnectPrivateCloud({ store: kv });
    expect(await kv.get(StorageKeys.token)).toBe('public-tok');
  });
});
