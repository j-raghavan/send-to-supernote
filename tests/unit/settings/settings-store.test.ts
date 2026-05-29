import { beforeEach, describe, expect, it } from 'vitest';
import { SettingsStore } from '@settings/settings-store';
import { DEFAULT_SETTINGS } from '@domain/settings';
import { StorageKeys } from '@shared/storage-keys';
import { FakeKeyValueStore } from '../../fakes/fake-key-value-store';

describe('SettingsStore (F6/F7)', () => {
  let kv: FakeKeyValueStore;
  let settings: SettingsStore;

  beforeEach(() => {
    kv = new FakeKeyValueStore();
    settings = new SettingsStore(kv);
  });

  it('returns defaults when nothing is stored', async () => {
    expect(await settings.get()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips each setting', async () => {
    await settings.setDefaultMode('reader');
    await settings.setDefaultFormat('epub');
    await settings.setTarget('privatecloud');
    await settings.setCloudFolderId('folder-7');
    await settings.setConfirmFilename(true);
    expect(await settings.get()).toEqual({
      defaultMode: 'reader',
      defaultFormat: 'epub',
      target: 'privatecloud',
      cloudFolderId: 'folder-7',
      confirmFilename: true,
    });
  });

  it('falls back to defaults for invalid/corrupt stored values', async () => {
    await kv.set(StorageKeys.defaultMode, 'bogus');
    await kv.set(StorageKeys.defaultFormat, 42);
    await kv.set(StorageKeys.target, null);
    await kv.set(StorageKeys.confirmFilename, 'yes');
    const result = await settings.get();
    expect(result.defaultMode).toBe('reader');
    expect(result.defaultFormat).toBe('epub');
    expect(result.target).toBe('cloud');
    expect(result.confirmFilename).toBe(false);
  });

  it('omits cloudFolderId when not a string', async () => {
    await kv.set(StorageKeys.cloudFolderId, 123);
    expect((await settings.get()).cloudFolderId).toBeUndefined();
  });
});
