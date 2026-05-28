/**
 * F7 Options — AC-traceability flows (mocked port/storage fakes).
 *
 * The per-FR units cover settings round-trip, folder normalization, privacy copy,
 * and onboarding. This file ties the behaviors to the Acceptance Criteria not yet
 * cited by id and adds the end-to-end folder-picker + selected-folder-on-send and
 * "Y"/"N" normalization flows the technical-lead asked for:
 *
 *  - F7-AC2: the folder picker lists real folders (paginated by the port) and only
 *            folders are selectable — boolean isFolder AND string "Y"/"N" both
 *            normalized (cloud vs private listing shapes).
 *  - F7-AC3: a selected folder is persisted under the target key, read back by
 *            SettingsStore with no reload, and used as the upload directoryId on
 *            the next send (ties F5-AC3).
 *  - F7-AC4: the Options privacy surface exposes a Privacy Policy link and the
 *            "password never stored" statement.
 *
 * No real Supernote/S3/private server is contacted.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { listFolders } from '@settings/list-folders';
import { selectableFolders, pickFolder, folderKeyForTarget } from '@settings/pick-folder';
import { SettingsStore } from '@settings/settings-store';
import { resolveSendRequest } from '@jobs/resolve-send-request';
import { parseFolderList, type Folder } from '@domain/delivery';
import { StorageKeys } from '@shared/storage-keys';
import { PASSWORD_NEVER_STORED, PRIVACY_POLICY_URL } from '../../src/options/privacy-copy';
import { FakeDeliveryPort } from '../fakes/fake-delivery-port';
import { FakeKeyValueStore } from '../fakes/fake-key-value-store';
import { ok } from '@shared/result';

describe('F7-AC2 — folder picker lists real folders, only folders selectable', () => {
  let port: FakeDeliveryPort;

  beforeEach(() => {
    port = new FakeDeliveryPort();
  });

  it('lists the real folders for a directory and keeps only the selectable folders', async () => {
    const listing: Folder[] = [
      { id: '7', name: 'Document', isFolder: true },
      { id: '8', name: 'WebClips', isFolder: true },
      { id: '9', name: 'note.pdf', isFolder: false },
    ];
    port.foldersByDirectory.set('0', ok(listing));

    const listed = await listFolders(port);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    // The real folders are surfaced for the picker.
    expect(listed.value.map((f) => f.name)).toEqual(['Document', 'WebClips', 'note.pdf']);
    // Only folders are selectable as a destination (the file is dropped).
    const selectable = selectableFolders(listed.value);
    expect(selectable.map((f) => f.name)).toEqual(['Document', 'WebClips']);
  });

  it('normalizes a public boolean isFolder listing', () => {
    const raw = {
      userFileVOList: [
        { id: '1', fileName: 'Document', isFolder: true },
        { id: '2', fileName: 'a.pdf', isFolder: false },
      ],
    };
    const folders = parseFolderList(raw);
    expect(selectableFolders(folders).map((f) => f.id)).toEqual(['1']);
  });

  it('normalizes a private "Y"/"N" string isFolder listing (cloud vs private shape)', () => {
    // Private Cloud uses the STRING "Y"/"N" and large numeric-string ids.
    const raw = {
      userFileVOList: [
        { id: '778507258773372928', fileName: 'Document', isFolder: 'Y' },
        { id: '778507258773372999', fileName: 'b.pdf', isFolder: 'N' },
      ],
    };
    const folders = parseFolderList(raw);
    expect(folders).toEqual([
      { id: '778507258773372928', name: 'Document', isFolder: true },
      { id: '778507258773372999', name: 'b.pdf', isFolder: false },
    ]);
    expect(selectableFolders(folders).map((f) => f.name)).toEqual(['Document']);
  });
});

describe('F7-AC3 — a selected folder is persisted and used on the next send (ties F5-AC3)', () => {
  it('cloud: pick → persist under cloudFolderId → settings read → send uses it (no reload)', async () => {
    const kv = new FakeKeyValueStore();

    // The picker persists the chosen cloud folder under the cloud key.
    await pickFolder(kv, 'cloud', 'webclips-9');
    expect(await kv.get(folderKeyForTarget('cloud'))).toBe('webclips-9');

    // SettingsStore reads it fresh (no in-memory cache → no reload needed).
    const settings = await new SettingsStore(kv).get();
    expect(settings.cloudFolderId).toBe('webclips-9');

    // The next resolved send request carries it as the destination folderId.
    const req = resolveSendRequest(settings, { hostname: 'example.com' });
    expect(req.folderId).toBe('webclips-9');
    expect(req.folderId).not.toBe(StorageKeys.cloudFolderId); // a real id, not a key
  });

  it('private: pick persists under the private folder key (distinct from cloud)', async () => {
    const kv = new FakeKeyValueStore();
    await pickFolder(kv, 'privatecloud', 'pc-folder-778507258773372928');
    expect(await kv.get(StorageKeys.privateFolderId)).toBe('pc-folder-778507258773372928');
    // The cloud key is untouched — the two targets keep separate destinations.
    expect(await kv.get(StorageKeys.cloudFolderId)).toBeUndefined();
  });
});

describe('F7-AC4 — privacy link + "password never stored" present', () => {
  it('exposes a Privacy Policy URL (https) for the Options link', () => {
    expect(PRIVACY_POLICY_URL).toMatch(/^https:\/\/\S+$/);
  });

  it('states plainly that the password is never stored (only a local token)', () => {
    const copy = PASSWORD_NEVER_STORED.toLowerCase();
    expect(copy).toContain('password');
    expect(copy).toContain('never');
    expect(copy).toContain('token');
  });
});
