/**
 * SettingsStore (Data Model, F6/F7) — typed get/save over the KeyValueStore.
 *
 * Reads validate each value and fall back to DEFAULT_SETTINGS so a missing or
 * corrupt key never breaks a send (F6 reads; F7 writes). Settings take effect on
 * the next read with no reload (F7-FR4). All keys live in chrome.storage.local
 * (I-5) via the injected store.
 */
import type { KeyValueStore } from '@shared/ports';
import { StorageKeys } from '@shared/storage-keys';
import {
  type CaptureMode,
  DEFAULT_SETTINGS,
  isCaptureMode,
  isOutputFormat,
  isTarget,
  type OutputFormat,
  type Settings,
  type Target,
} from '@domain/settings';

export class SettingsStore {
  constructor(private readonly store: KeyValueStore) {}

  /** Read the full settings, validating each value against its domain type. */
  async get(): Promise<Settings> {
    const [mode, format, target, cloudFolderId, confirm, includeImages] = await Promise.all([
      this.store.get<unknown>(StorageKeys.defaultMode),
      this.store.get<unknown>(StorageKeys.defaultFormat),
      this.store.get<unknown>(StorageKeys.target),
      this.store.get<unknown>(StorageKeys.cloudFolderId),
      this.store.get<unknown>(StorageKeys.confirmFilename),
      this.store.get<unknown>(StorageKeys.includeImages),
    ]);
    return {
      defaultMode: isCaptureMode(mode) ? mode : DEFAULT_SETTINGS.defaultMode,
      defaultFormat: isOutputFormat(format) ? format : DEFAULT_SETTINGS.defaultFormat,
      target: isTarget(target) ? target : DEFAULT_SETTINGS.target,
      ...(typeof cloudFolderId === 'string' ? { cloudFolderId } : {}),
      confirmFilename: typeof confirm === 'boolean' ? confirm : DEFAULT_SETTINGS.confirmFilename,
      includeImages:
        typeof includeImages === 'boolean' ? includeImages : DEFAULT_SETTINGS.includeImages,
    };
  }

  setDefaultMode(mode: CaptureMode): Promise<void> {
    return this.store.set(StorageKeys.defaultMode, mode);
  }

  setDefaultFormat(format: OutputFormat): Promise<void> {
    return this.store.set(StorageKeys.defaultFormat, format);
  }

  setTarget(target: Target): Promise<void> {
    return this.store.set(StorageKeys.target, target);
  }

  setCloudFolderId(folderId: string): Promise<void> {
    return this.store.set(StorageKeys.cloudFolderId, folderId);
  }

  setConfirmFilename(confirm: boolean): Promise<void> {
    return this.store.set(StorageKeys.confirmFilename, confirm);
  }

  setIncludeImages(value: boolean): Promise<void> {
    return this.store.set(StorageKeys.includeImages, value);
  }
}
