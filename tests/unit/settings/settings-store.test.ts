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
    await settings.setIncludeImages(false);
    await settings.setIncludeProvenance(true);
    expect(await settings.get()).toEqual({
      defaultMode: 'reader',
      defaultFormat: 'epub',
      target: 'privatecloud',
      cloudFolderId: 'folder-7',
      confirmFilename: true,
      includeImages: false,
      includeProvenance: true,
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

  describe('includeImages (per-send "Include images")', () => {
    it('returns the stored value when it is a boolean (true)', async () => {
      await kv.set(StorageKeys.includeImages, true);
      expect((await settings.get()).includeImages).toBe(true);
    });

    it('returns the stored value when it is a boolean (false)', async () => {
      await settings.setIncludeImages(false);
      expect((await settings.get()).includeImages).toBe(false);
    });

    it('falls back to the default (true) when nothing is stored', async () => {
      expect((await settings.get()).includeImages).toBe(DEFAULT_SETTINGS.includeImages);
      expect((await settings.get()).includeImages).toBe(true);
    });

    it('falls back to the default (true) when the stored value is not a boolean', async () => {
      await kv.set(StorageKeys.includeImages, 'yes');
      expect((await settings.get()).includeImages).toBe(true);
    });

    it('setIncludeImages writes the settings.includeImages key', async () => {
      await settings.setIncludeImages(false);
      expect(await kv.get(StorageKeys.includeImages)).toBe(false);
      expect(StorageKeys.includeImages).toBe('settings.includeImages');
    });
  });

  describe('includeProvenance ("Add source & time", default OFF)', () => {
    it('falls back to the default (false) when nothing is stored', async () => {
      expect((await settings.get()).includeProvenance).toBe(DEFAULT_SETTINGS.includeProvenance);
      expect((await settings.get()).includeProvenance).toBe(false);
    });

    it('returns the stored value when it is a boolean (true)', async () => {
      await settings.setIncludeProvenance(true);
      expect((await settings.get()).includeProvenance).toBe(true);
    });

    it('falls back to the default (false) when the stored value is not a boolean', async () => {
      await kv.set(StorageKeys.includeProvenance, 'yes');
      expect((await settings.get()).includeProvenance).toBe(false);
    });

    it('setIncludeProvenance writes the settings.includeProvenance key', async () => {
      await settings.setIncludeProvenance(true);
      expect(await kv.get(StorageKeys.includeProvenance)).toBe(true);
      expect(StorageKeys.includeProvenance).toBe('settings.includeProvenance');
    });
  });
});
