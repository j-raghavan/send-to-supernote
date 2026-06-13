import { describe, expect, it } from 'vitest';
import { resolveSendRequest } from '@jobs/resolve-send-request';
import type { Settings } from '@domain/settings';

const settings: Settings = {
  defaultMode: 'reader',
  defaultFormat: 'pdf',
  target: 'cloud',
  cloudFolderId: 'doc-7',
  confirmFilename: false,
  includeImages: true,
  includeProvenance: false,
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
      format: 'epub',
      target: 'privatecloud',
    });
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

  describe('Full Page forces PDF (FP1-FR3)', () => {
    it('forces format:pdf when mode comes from settings.defaultMode=fullpage, even with defaultFormat=epub', () => {
      const fullpageSettings: Settings = {
        ...settings,
        defaultMode: 'fullpage',
        defaultFormat: 'epub',
      };
      const req = resolveSendRequest(fullpageSettings, page);
      expect(req.mode).toBe('fullpage');
      expect(req.format).toBe('pdf');
    });

    it('forces format:pdf when mode comes from overrides.mode=fullpage, even with overrides.format=epub', () => {
      const epubSettings: Settings = { ...settings, defaultFormat: 'epub' };
      const req = resolveSendRequest(epubSettings, page, {
        mode: 'fullpage',
        format: 'epub',
      });
      expect(req.mode).toBe('fullpage');
      expect(req.format).toBe('pdf');
    });

    it('keeps target/folderId/confirmFilename/page identical across reader and fullpage', () => {
      const base: Settings = { ...settings, defaultMode: 'reader', defaultFormat: 'pdf' };
      const reader = resolveSendRequest(base, page);
      const fullpage = resolveSendRequest({ ...base, defaultMode: 'fullpage' }, page);
      expect(fullpage.target).toBe(reader.target);
      expect(fullpage.folderId).toBe(reader.folderId);
      expect(fullpage.confirmFilename).toBe(reader.confirmFilename);
      expect(fullpage.page).toBe(reader.page);
    });

    it('still honors overrides.format ?? defaultFormat for the reader path', () => {
      const epubSettings: Settings = { ...settings, defaultMode: 'reader', defaultFormat: 'epub' };
      // No override → defaultFormat.
      expect(resolveSendRequest(epubSettings, page).format).toBe('epub');
      // Override wins for reader.
      expect(resolveSendRequest(epubSettings, page, { format: 'pdf' }).format).toBe('pdf');
    });
  });

  describe('includeImages (per-send "Include images")', () => {
    it('carries the stored setting when there is no override (true)', () => {
      expect(resolveSendRequest({ ...settings, includeImages: true }, page).includeImages).toBe(
        true,
      );
    });

    it('carries the stored setting when there is no override (false)', () => {
      expect(resolveSendRequest({ ...settings, includeImages: false }, page).includeImages).toBe(
        false,
      );
    });

    it('lets a one-off override win over a true stored setting (pins ??, false override)', () => {
      const req = resolveSendRequest({ ...settings, includeImages: true }, page, {
        includeImages: false,
      });
      expect(req.includeImages).toBe(false);
    });

    it('lets a one-off override win over a false stored setting (pins ??, true override)', () => {
      const req = resolveSendRequest({ ...settings, includeImages: false }, page, {
        includeImages: true,
      });
      expect(req.includeImages).toBe(true);
    });
  });

  describe('includeProvenance ("Add source & time", default OFF)', () => {
    it('carries the stored setting when there is no override (false)', () => {
      expect(resolveSendRequest(settings, page).includeProvenance).toBe(false);
    });

    it('carries the stored setting when there is no override (true)', () => {
      expect(
        resolveSendRequest({ ...settings, includeProvenance: true }, page).includeProvenance,
      ).toBe(true);
    });

    it('lets a one-off override win over the stored setting (pins ??)', () => {
      expect(
        resolveSendRequest({ ...settings, includeProvenance: false }, page, {
          includeProvenance: true,
        }).includeProvenance,
      ).toBe(true);
      expect(
        resolveSendRequest({ ...settings, includeProvenance: true }, page, {
          includeProvenance: false,
        }).includeProvenance,
      ).toBe(false);
    });
  });
});
