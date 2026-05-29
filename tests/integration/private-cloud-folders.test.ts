/**
 * Integration: Private Cloud Document/ resolution + folder picking (F8-FR3).
 *
 * Proves the SHARED folder use cases (resolveDocumentFolderId from F5-FR3,
 * pickFolder from F7-FR2) work unchanged against the PrivateCloudAdapter, with
 * the "Y"/"N" isFolder normalization and the privatecloud.folderId key.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PrivateCloudAdapter, PC_LIST_PATH } from '../../src/delivery/private-cloud-adapter';
import { resolveDocumentFolderId } from '@settings/list-folders';
import { pickFolder } from '@settings/pick-folder';
import { StorageKeys } from '@shared/storage-keys';
import { FakeHttpClient } from '../fakes/fake-http-client';
import { FakeKeyValueStore } from '../fakes/fake-key-value-store';
import { FakeRandomSource } from '../fakes/fake-random-source';
import { FakeClock } from '../fakes/fake-clock';

const BASE = 'http://192.168.1.5:8080';

function adapter(http: FakeHttpClient): PrivateCloudAdapter {
  return new PrivateCloudAdapter({
    http,
    baseUrl: BASE,
    token: 'jwt',
    random: new FakeRandomSource(),
    clock: new FakeClock(0),
  });
}

describe('Private Cloud Document/ resolution (F8-FR3)', () => {
  let http: FakeHttpClient;

  beforeEach(() => {
    http = new FakeHttpClient();
  });

  it('resolves the Document/ folder id from a "Y"/"N" root listing (not root)', async () => {
    http.on(PC_LIST_PATH, {
      status: 200,
      json: {
        code: 0,
        data: {
          total: 2,
          userFileVOList: [
            { id: '111', fileName: 'Inbox', isFolder: 'Y' },
            { id: '778507258773372928', fileName: 'Document', isFolder: 'Y' },
          ],
        },
      },
    });
    const result = await resolveDocumentFolderId(adapter(http));
    expect(result.ok && result.value).toBe('778507258773372928');
  });

  it('surfaces no-document-folder rather than silently using root', async () => {
    http.on(PC_LIST_PATH, {
      status: 200,
      json: { code: 0, data: { userFileVOList: [{ id: '1', fileName: 'Other', isFolder: 'Y' }] } },
    });
    const result = await resolveDocumentFolderId(adapter(http));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('no-document-folder');
    }
  });

  it('a connection error during resolution surfaces (not an auth prompt)', async () => {
    http.on(PC_LIST_PATH, () => {
      throw new Error('unreachable');
    });
    const result = await resolveDocumentFolderId(adapter(http));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('connection');
    }
  });

  it('picking a PC subfolder stores it under privatecloud.folderId', async () => {
    const kv = new FakeKeyValueStore();
    await pickFolder(kv, 'privatecloud', '778507258773372928');
    expect(await kv.get(StorageKeys.privateFolderId)).toBe('778507258773372928');
  });
});
