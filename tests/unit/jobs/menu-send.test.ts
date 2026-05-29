import { describe, expect, it } from 'vitest';
import { menuSendRequest } from '@jobs/menu-send';
import { MENU_READER } from '@capture/triggers';
import type { Settings } from '@domain/settings';

const settings: Settings = {
  defaultMode: 'reader',
  defaultFormat: 'pdf',
  target: 'cloud',
  cloudFolderId: 'doc-7',
  confirmFilename: false,
};

const page = { hostname: 'example.com' };

describe('menuSendRequest (F6-FR2)', () => {
  it('builds a Reader View request from the reader menu item', () => {
    const req = menuSendRequest(MENU_READER.id, settings, page);
    expect(req?.mode).toBe('reader');
    expect(req?.target).toBe('cloud');
    expect(req?.folderId).toBe('doc-7');
  });

  it('returns undefined for an unrecognized menu id', () => {
    expect(menuSendRequest('unknown-item', settings, page)).toBeUndefined();
  });
});
