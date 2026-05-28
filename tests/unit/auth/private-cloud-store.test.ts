import { beforeEach, describe, expect, it } from 'vitest';
import { PrivateCloudStore } from '@auth/private-cloud-store';
import { StorageKeys } from '@shared/storage-keys';
import { FakeKeyValueStore } from '../../fakes/fake-key-value-store';

describe('PrivateCloudStore (F8)', () => {
  let kv: FakeKeyValueStore;
  let pc: PrivateCloudStore;

  beforeEach(() => {
    kv = new FakeKeyValueStore();
    pc = new PrivateCloudStore(kv);
  });

  it('reads the JWT, base URL, account, and folder', async () => {
    await kv.set(StorageKeys.privateToken, 'jwt');
    await kv.set(StorageKeys.privateBaseUrl, 'http://host:8080');
    await kv.set(StorageKeys.privateAccount, 'me@x.com');
    await kv.set(StorageKeys.privateFolderId, 'doc-9');
    expect(await pc.getToken()).toBe('jwt');
    expect(await pc.getBaseUrl()).toBe('http://host:8080');
    expect(await pc.getAccount()).toBe('me@x.com');
    expect(await pc.getFolderId()).toBe('doc-9');
  });

  it('returns undefined when nothing is stored', async () => {
    expect(await pc.getToken()).toBeUndefined();
    expect(await pc.getBaseUrl()).toBeUndefined();
    expect(await pc.getFolderId()).toBeUndefined();
  });

  it('clearToken removes only the JWT, keeping baseUrl + account for re-login prefill', async () => {
    await kv.set(StorageKeys.privateToken, 'jwt');
    await kv.set(StorageKeys.privateBaseUrl, 'http://host:8080');
    await kv.set(StorageKeys.privateAccount, 'me@x.com');
    await pc.clearToken();
    expect(await pc.getToken()).toBeUndefined();
    expect(await pc.getBaseUrl()).toBe('http://host:8080');
    expect(await pc.getAccount()).toBe('me@x.com');
  });
});
