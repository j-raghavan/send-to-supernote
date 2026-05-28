import { describe, expect, it } from 'vitest';
import { resolveSendRequest } from '@jobs/resolve-send-request';
import type { Settings } from '@domain/settings';

const settings: Settings = {
  defaultMode: 'reader',
  defaultFormat: 'pdf',
  target: 'cloud',
  cloudFolderId: 'doc-7',
  confirmFilename: false,
};

const page = { hostname: 'example.com' };

describe('resolveSendRequest (F6-FR1)', () => {
  it('uses the stored defaults for a toolbar send', () => {
    const req = resolveSendRequest(settings, page);
    expect(req.mode).toBe('reader');
    expect(req.format).toBe('pdf');
    expect(req.target).toBe('cloud');
    expect(req.folderId).toBe('doc-7');
    expect(req.confirmFilename).toBe(false);
    expect(req.page).toBe(page);
  });

  it('applies one-off overrides (popup, F6-FR6)', () => {
    const req = resolveSendRequest(settings, page, {
      mode: 'fullpage',
      format: 'epub',
      target: 'privatecloud',
    });
    expect(req.mode).toBe('fullpage');
    expect(req.format).toBe('epub');
    expect(req.target).toBe('privatecloud');
  });

  it('does not carry the cloud folder id when targeting Private Cloud', () => {
    const req = resolveSendRequest(settings, page, { target: 'privatecloud' });
    expect(req.folderId).toBeUndefined();
  });

  it('omits folderId when no cloud folder is configured', () => {
    const noFolder: Settings = { ...settings };
    delete noFolder.cloudFolderId;
    expect(resolveSendRequest(noFolder, page).folderId).toBeUndefined();
  });
});
