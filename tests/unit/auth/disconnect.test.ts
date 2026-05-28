import { beforeEach, describe, expect, it, vi } from 'vitest';
import { disconnect, disconnectPublicCloud } from '../../../src/auth/disconnect';
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
