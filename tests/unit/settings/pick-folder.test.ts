import { beforeEach, describe, expect, it } from 'vitest';
import { folderKeyForTarget, pickFolder, selectableFolders } from '@settings/pick-folder';
import { StorageKeys } from '@shared/storage-keys';
import type { Folder } from '@domain/delivery';
import { FakeKeyValueStore } from '../../fakes/fake-key-value-store';

const folders: Folder[] = [
  { id: '1', name: 'Document', isFolder: true },
  { id: '2', name: 'note.pdf', isFolder: false },
  { id: '3', name: 'WebClips', isFolder: true },
];

describe('selectableFolders (F7-FR2)', () => {
  it('keeps only folder entries (normalized isFolder), dropping files', () => {
    expect(selectableFolders(folders).map((f) => f.name)).toEqual(['Document', 'WebClips']);
  });

  it('handles a "Y"/"N"-normalized listing (already booleans here)', () => {
    expect(selectableFolders([{ id: '9', name: 'F', isFolder: true }])).toHaveLength(1);
  });
});

describe('folderKeyForTarget (F7-FR2)', () => {
  it('maps cloud to settings.cloudFolderId', () => {
    expect(folderKeyForTarget('cloud')).toBe(StorageKeys.cloudFolderId);
  });

  it('maps privatecloud to privatecloud.folderId', () => {
    expect(folderKeyForTarget('privatecloud')).toBe(StorageKeys.privateFolderId);
  });
});

describe('pickFolder (F7-FR2)', () => {
  let kv: FakeKeyValueStore;

  beforeEach(() => {
    kv = new FakeKeyValueStore();
  });

  it('persists the cloud folder id under the cloud key', async () => {
    await pickFolder(kv, 'cloud', 'doc-7');
    expect(await kv.get(StorageKeys.cloudFolderId)).toBe('doc-7');
  });

  it('persists the private folder id under the private key', async () => {
    await pickFolder(kv, 'privatecloud', 'big-id-778507258773372928');
    expect(await kv.get(StorageKeys.privateFolderId)).toBe('big-id-778507258773372928');
  });
});
