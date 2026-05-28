import { describe, expect, it } from 'vitest';
import { buildPopupView, popupSendRequest } from '../../../src/popup/popup-view';
import type { Settings } from '@domain/settings';

const settings: Settings = {
  defaultMode: 'reader',
  defaultFormat: 'pdf',
  target: 'cloud',
  cloudFolderId: 'doc-7',
  confirmFilename: false,
};

describe('buildPopupView (F6-FR6)', () => {
  it('shows connected state and allows sending', () => {
    const view = buildPopupView('connected', 'me@x.com', settings);
    expect(view.canSend).toBe(true);
    expect(view.status).toBe('Connected as me@x.com');
    expect(view.modeLabel).toBe('Reader View');
    expect(view.selectedMode).toBe('reader');
    expect(view.selectedTarget).toBe('cloud');
  });

  it('blocks sending and prompts reconnect when expired', () => {
    const view = buildPopupView('expired', 'me@x.com', settings);
    expect(view.canSend).toBe(false);
    expect(view.status).toContain('expired');
  });

  it('blocks sending and prompts connect when disconnected', () => {
    const view = buildPopupView('disconnected', undefined, settings);
    expect(view.canSend).toBe(false);
    expect(view.status).toContain('Not connected');
  });

  it('treats connected-without-account as not sendable status text', () => {
    const view = buildPopupView('connected', undefined, settings);
    // canSend is true (session), but the status line falls back gracefully
    expect(view.canSend).toBe(true);
    expect(view.status).toContain('Not connected');
  });
});

describe('popupSendRequest (F6-FR6 one-off pick)', () => {
  it('applies the popup overrides for a one-off send', () => {
    const req = popupSendRequest(
      settings,
      { hostname: 'example.com' },
      {
        mode: 'fullpage',
        format: 'epub',
        target: 'privatecloud',
      },
    );
    expect(req.mode).toBe('fullpage');
    expect(req.format).toBe('epub');
    expect(req.target).toBe('privatecloud');
  });

  it('defaults to settings when no override is given', () => {
    const req = popupSendRequest(settings, { hostname: 'example.com' }, {});
    expect(req.mode).toBe('reader');
    expect(req.target).toBe('cloud');
  });
});
