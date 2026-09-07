import { describe, expect, it } from 'vitest';
import {
  buildPopupView,
  connectFailureMessage,
  popupSendRequest,
} from '../../../src/popup/popup-view';
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

  it('shows a connected status without an email (cookie-capture cloud connect)', () => {
    const view = buildPopupView('connected', undefined, settings);
    // The cookie-capture cloud flow has no email, so the status reflects the
    // connection generically rather than falling back to "Not connected".
    expect(view.canSend).toBe(true);
    expect(view.status).toBe('Connected to Supernote Cloud');
  });
});

describe('popupSendRequest (F6-FR6 one-off pick)', () => {
  it('applies the popup overrides for a one-off send', () => {
    const req = popupSendRequest(
      settings,
      { hostname: 'example.com' },
      {
        format: 'epub',
        target: 'privatecloud',
      },
    );
    expect(req.format).toBe('epub');
    expect(req.target).toBe('privatecloud');
  });

  it('defaults to settings when no override is given', () => {
    const req = popupSendRequest(settings, { hostname: 'example.com' }, {});
    expect(req.mode).toBe('reader');
    expect(req.target).toBe('cloud');
  });
});

describe('connectFailureMessage', () => {
  it('frames ONLY a login rejection (kind: auth) as a sign-in failure', () => {
    expect(connectFailureMessage({ kind: 'auth', error: 'invalid credentials' })).toBe(
      'Could not sign in: invalid credentials',
    );
    expect(connectFailureMessage({ kind: 'auth' })).toBe('Could not sign in: unknown error');
  });

  it('shows a network failure hint as-is (no "Could not sign in" framing)', () => {
    const msg = connectFailureMessage({
      kind: 'network',
      error: "Couldn't reach your server at https://x.",
    });
    expect(msg).toBe("Couldn't reach your server at https://x.");
    expect(msg).not.toContain('Could not sign in');
  });

  it('shows an infrastructure failure (no kind) as-is — never mis-framed as sign-in', () => {
    // e.g. the SW didn't respond: a standalone message, not a login rejection.
    expect(connectFailureMessage({ error: 'Background service worker did not respond.' })).toBe(
      'Background service worker did not respond.',
    );
    expect(connectFailureMessage({})).toBe("Couldn't reach your Private Cloud server.");
  });
});
