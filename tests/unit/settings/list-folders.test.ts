import { beforeEach, describe, expect, it } from 'vitest';
import { listFolders, resolveDocumentFolderId } from '../../../src/settings/list-folders';
import { ok, err } from '@shared/result';
import type { Folder } from '@domain/delivery';
import { FakeDeliveryPort } from '../../fakes/fake-delivery-port';

describe('listFolders (F7-FR2)', () => {
  let port: FakeDeliveryPort;

  beforeEach(() => {
    port = new FakeDeliveryPort();
  });

  it('lists a directory by id', async () => {
    const folders: Folder[] = [{ id: '7', name: 'Document', isFolder: true }];
    port.foldersByDirectory.set('7', ok(folders));
    const result = await listFolders(port, '7');
    expect(result.ok && result.value).toEqual(folders);
    expect(port.listCalls).toEqual(['7']);
  });

  it('defaults to listing the root directory', async () => {
    await listFolders(port);
    expect(port.listCalls).toEqual(['0']);
  });
});

describe('resolveDocumentFolderId (F5-FR3)', () => {
  let port: FakeDeliveryPort;

  beforeEach(() => {
    port = new FakeDeliveryPort();
  });

  it('resolves the Document/ folder id from the root listing (not root)', async () => {
    port.foldersByDirectory.set(
      '0',
      ok([
        { id: '1', name: 'Inbox', isFolder: true },
        { id: '7', name: 'Document', isFolder: true },
      ]),
    );
    const result = await resolveDocumentFolderId(port);
    expect(result.ok && result.value).toBe('7');
    expect(port.listCalls).toEqual(['0']);
  });

  it('surfaces no-document-folder rather than silently using root (Edge Cases)', async () => {
    port.foldersByDirectory.set('0', ok([{ id: '1', name: 'Other', isFolder: true }]));
    const result = await resolveDocumentFolderId(port);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('no-document-folder');
    }
  });

  it('propagates a delivery failure from the root listing', async () => {
    port.foldersByDirectory.set('0', err({ kind: 'auth', message: 'expired' }));
    const result = await resolveDocumentFolderId(port);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('auth');
    }
  });
});
