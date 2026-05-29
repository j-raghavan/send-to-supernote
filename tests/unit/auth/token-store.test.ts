import { beforeEach, describe, expect, it } from 'vitest';
import { TokenStore } from '../../../src/auth/token-store';
import { StorageKeys } from '@shared/storage-keys';
import { FakeKeyValueStore } from '../../fakes/fake-key-value-store';

describe('TokenStore (F2)', () => {
  let kv: FakeKeyValueStore;
  let tokens: TokenStore;

  beforeEach(() => {
    kv = new FakeKeyValueStore();
    tokens = new TokenStore(kv);
  });

  it('saves token, account, and equipment', async () => {
    await tokens.save({ token: 'tok', account: 'a@b.com', equipment: 'eq-1' });
    expect(await tokens.getToken()).toBe('tok');
    expect(await tokens.getAccount()).toBe('a@b.com');
    expect(await tokens.getEquipment()).toBe('eq-1');
  });

  it('stores the token under the supernote.token key', async () => {
    await tokens.save({ token: 'tok', account: 'a@b.com', equipment: 'eq-1' });
    expect(await kv.get(StorageKeys.token)).toBe('tok');
  });

  it('returns undefined for token/account/equipment when nothing stored', async () => {
    expect(await tokens.getToken()).toBeUndefined();
    expect(await tokens.getAccount()).toBeUndefined();
    expect(await tokens.getEquipment()).toBeUndefined();
  });

  it('clearToken removes only the token, keeping account + equipment for re-login prefill', async () => {
    await tokens.save({ token: 'tok', account: 'a@b.com', equipment: 'eq-1' });
    await tokens.clearToken();
    expect(await tokens.getToken()).toBeUndefined();
    expect(await tokens.getAccount()).toBe('a@b.com');
    expect(await tokens.getEquipment()).toBe('eq-1');
  });
});
