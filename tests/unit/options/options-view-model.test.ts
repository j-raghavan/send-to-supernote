import { describe, expect, it } from 'vitest';
import {
  buildOptionsView,
  canPickPrivateFolder,
  coerceFormatForMode,
  parseFormatChange,
  parseModeChange,
  parseTargetChange,
} from '../../../src/options/options-view-model';
import type { Settings } from '@domain/settings';

const settings: Settings = {
  defaultMode: 'reader',
  defaultFormat: 'pdf',
  target: 'cloud',
  cloudFolderId: 'doc-7',
  confirmFilename: false,
};

describe('buildOptionsView (F7-FR1)', () => {
  it('shows the connected account and exposes the settings', () => {
    const view = buildOptionsView('connected', 'me@x.com', settings);
    expect(view.connected).toBe(true);
    expect(view.connectionStatus).toBe('Connected as me@x.com');
    expect(view.defaultMode).toBe('reader');
    expect(view.defaultFormat).toBe('pdf');
    expect(view.target).toBe('cloud');
    expect(view.confirmFilename).toBe(false);
    expect(view.canPickCloudFolder).toBe(true);
  });

  it('reflects the settings defaultMode in the view (FP1-FR2 / FP8-FR1)', () => {
    const view = buildOptionsView('connected', 'me@x.com', {
      ...settings,
      defaultMode: 'fullpage',
    });
    expect(view.defaultMode).toBe('fullpage');
  });

  it('shows a generic connected status when no email is known (cookie-capture cloud connect)', () => {
    const view = buildOptionsView('connected', undefined, settings);
    expect(view.connected).toBe(true);
    expect(view.connectionStatus).toBe('Connected to Supernote Cloud');
  });

  it('reports expired and disconnected states', () => {
    expect(buildOptionsView('expired', 'me@x.com', settings).connectionStatus).toContain('expired');
    expect(buildOptionsView('disconnected', undefined, settings).connectionStatus).toBe(
      'Not connected',
    );
  });

  it('does not allow the cloud folder picker when disconnected', () => {
    expect(buildOptionsView('disconnected', undefined, settings).canPickCloudFolder).toBe(false);
  });

  it('does not allow the cloud folder picker when targeting Private Cloud', () => {
    const view = buildOptionsView('connected', 'me@x.com', { ...settings, target: 'privatecloud' });
    expect(view.canPickCloudFolder).toBe(false);
  });

  it('omits the account field when none is connected', () => {
    expect(buildOptionsView('disconnected', undefined, settings).account).toBeUndefined();
  });

  describe('format enable + coercion by mode (Issue 3)', () => {
    it('enables both pdf and epub for reader settings', () => {
      const view = buildOptionsView('connected', 'me@x.com', settings);
      expect(view.formatEnabled).toEqual({ pdf: true, epub: true });
    });

    it('enables pdf only and disables epub for fullpage settings', () => {
      const view = buildOptionsView('connected', 'me@x.com', {
        ...settings,
        defaultMode: 'fullpage',
      });
      expect(view.formatEnabled).toEqual({ pdf: true, epub: false });
    });

    it('coerces a stored fullpage+epub to pdf and disables epub (Issue-3 core)', () => {
      const view = buildOptionsView('connected', 'me@x.com', {
        ...settings,
        defaultMode: 'fullpage',
        defaultFormat: 'epub',
      });
      expect(view.defaultFormat).toBe('pdf');
      expect(view.formatEnabled.epub).toBe(false);
    });

    it('leaves a reader+epub default unchanged', () => {
      const view = buildOptionsView('connected', 'me@x.com', {
        ...settings,
        defaultMode: 'reader',
        defaultFormat: 'epub',
      });
      expect(view.defaultFormat).toBe('epub');
    });
  });
});

describe('coerceFormatForMode (Issue 3)', () => {
  it('coerces fullpage+epub to pdf and disables epub', () => {
    expect(coerceFormatForMode('fullpage', 'epub')).toEqual({
      value: 'pdf',
      formatEnabled: { pdf: true, epub: false },
    });
  });

  it('honors reader+epub and enables both', () => {
    expect(coerceFormatForMode('reader', 'epub')).toEqual({
      value: 'epub',
      formatEnabled: { pdf: true, epub: true },
    });
  });

  it('honors reader+pdf and enables both', () => {
    expect(coerceFormatForMode('reader', 'pdf')).toEqual({
      value: 'pdf',
      formatEnabled: { pdf: true, epub: true },
    });
  });
});

describe('canPickPrivateFolder (Private Cloud folder picker gate)', () => {
  it('is true only when connected to Private Cloud AND it is the active target', () => {
    expect(canPickPrivateFolder('connected', 'privatecloud')).toBe(true);
  });

  it('is false when the active target is Cloud (even if the PC session is connected)', () => {
    expect(canPickPrivateFolder('connected', 'cloud')).toBe(false);
  });

  it('is false when the Private Cloud session is not connected', () => {
    expect(canPickPrivateFolder('disconnected', 'privatecloud')).toBe(false);
    expect(canPickPrivateFolder('expired', 'privatecloud')).toBe(false);
  });
});

describe('control change validation (F7-FR1)', () => {
  it('accepts valid mode/format/target values', () => {
    expect(parseModeChange('reader')).toBe('reader');
    expect(parseModeChange('fullpage')).toBe('fullpage');
    expect(parseFormatChange('epub')).toBe('epub');
    expect(parseTargetChange('privatecloud')).toBe('privatecloud');
  });

  it('rejects invalid values', () => {
    expect(parseModeChange('bogus')).toBeUndefined();
    expect(parseFormatChange('docx')).toBeUndefined();
    expect(parseTargetChange('dropbox')).toBeUndefined();
  });
});
