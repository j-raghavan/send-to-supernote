/**
 * Integration: settings changes take effect immediately for the next send
 * with no reload (F7-FR4 / F7-AC1).
 *
 * The SettingsStore reads fresh from storage on every get() (no in-memory
 * cache), and the saga reads settings at send-time, so a change written by the
 * Options page is reflected in the very next resolveSendRequest.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SettingsStore } from '@settings/settings-store';
import { resolveSendRequest } from '@jobs/resolve-send-request';
import { FakeKeyValueStore } from '../fakes/fake-key-value-store';

describe('settings take effect immediately (F7-FR4)', () => {
  let kv: FakeKeyValueStore;
  let store: SettingsStore;

  beforeEach(() => {
    kv = new FakeKeyValueStore();
    store = new SettingsStore(kv);
  });

  it('a changed default format is used by the next resolved send request', async () => {
    // First send uses the default (EPUB).
    const before = resolveSendRequest(await store.get(), { hostname: 'x.com' });
    expect(before.format).toBe('epub');

    // Options changes the default; no reload happens.
    await store.setDefaultFormat('pdf');

    // The very next send (fresh get) reflects the change.
    const after = resolveSendRequest(await store.get(), { hostname: 'x.com' });
    expect(after.format).toBe('pdf');
  });

  it('a changed target + folder is used by the next send without reload', async () => {
    await store.setTarget('cloud');
    await store.setCloudFolderId('doc-7');
    const first = resolveSendRequest(await store.get(), { hostname: 'x.com' });
    expect(first.folderId).toBe('doc-7');

    await store.setCloudFolderId('webclips-9');
    const second = resolveSendRequest(await store.get(), { hostname: 'x.com' });
    expect(second.folderId).toBe('webclips-9');
  });

  it('toggling confirmFilename is reflected on the next send', async () => {
    expect(resolveSendRequest(await store.get(), { hostname: 'x.com' }).confirmFilename).toBe(
      false,
    );
    await store.setConfirmFilename(true);
    expect(resolveSendRequest(await store.get(), { hostname: 'x.com' }).confirmFilename).toBe(true);
  });
});
