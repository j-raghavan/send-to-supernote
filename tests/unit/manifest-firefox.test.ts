import { describe, expect, it } from 'vitest';
import { buildManifest, manifest } from '../../manifest.config';

// FF5 splits the manifest into a single shared base built per target via
// `buildManifest('chrome' | 'firefox')`. These assertions pin the Firefox
// manifest SHAPE and prove Chrome<->Firefox parity (only background, the
// offscreen permission, and the gecko block may differ). The live "loads in
// Firefox with zero errors" check is a MANUAL/runtime install gate (DoD).
const chrome = buildManifest('chrome');
const firefox = buildManifest('firefox');

describe('buildManifest("firefox") background (FF5-FR1 / FF5-AC1)', () => {
  it('uses an MV3 event page (background.scripts), not a service worker', () => {
    expect(firefox.background?.scripts).toEqual(['service-worker.js']);
    expect(firefox.background?.type).toBe('module');
  });

  it('does NOT declare a service worker on Firefox', () => {
    expect(firefox.background?.service_worker).toBeUndefined();
  });
});

describe('buildManifest("firefox") permissions (FF5-FR2)', () => {
  it('drops the Chrome-only offscreen permission', () => {
    expect(firefox.permissions).not.toContain('offscreen');
  });

  it('keeps the cross-target least-privilege permission set', () => {
    expect(firefox.permissions).toContain('cookies');
    expect(firefox.permissions).toContain('activeTab');
    expect(firefox.permissions).toContain('scripting');
    expect(firefox.permissions).toContain('contextMenus');
    expect(firefox.permissions).toContain('storage');
    expect(firefox.permissions).toContain('notifications');
    expect(firefox.permissions).toContain('declarativeNetRequestWithHostAccess');
  });

  it('does NOT request debugger or identity', () => {
    expect(firefox.permissions).not.toContain('debugger');
    expect(firefox.permissions).not.toContain('identity');
  });

  it('FF5: identity is absent in both required and optional permissions', () => {
    expect(firefox.permissions).not.toContain('identity');
    expect(firefox.optional_permissions ?? []).not.toContain('identity');
  });
});

describe('buildManifest("firefox") network strategy = DNR (FF5-FR3, locked)', () => {
  it('ships the DNR ruleset (dnr-rules.json), same as Chrome', () => {
    expect(firefox.declarative_net_request?.rule_resources?.[0]?.path).toBe('dnr-rules.json');
  });

  it('does NOT request webRequest or webRequestBlocking (DNR is the locked decision)', () => {
    expect(firefox.permissions).not.toContain('webRequest');
    expect(firefox.permissions).not.toContain('webRequestBlocking');
  });
});

describe('buildManifest("firefox") browser_specific_settings (FF5-FR1)', () => {
  it('declares the AMO-required gecko add-on id', () => {
    expect(firefox.browser_specific_settings?.gecko.id).toBe('send-to-supernote@j-raghavan');
  });

  it('pins the conservative strict_min_version', () => {
    expect(firefox.browser_specific_settings?.gecko.strict_min_version).toBe('128.0');
  });

  it('declares the AMO-required data_collection_permissions as none (no data collected)', () => {
    // AMO validation rejects new submissions without this key; we collect no data.
    expect(firefox.browser_specific_settings?.gecko.data_collection_permissions).toEqual({
      required: ['none'],
    });
  });
});

describe('buildManifest("firefox") host permissions (FF5-FR2)', () => {
  it('matches the Chrome static host_permissions exactly', () => {
    expect(firefox.host_permissions).toEqual(chrome.host_permissions);
  });

  it('matches the Chrome optional_host_permissions exactly', () => {
    expect(firefox.optional_host_permissions).toEqual(chrome.optional_host_permissions);
  });

  it('never declares <all_urls> as a static host permission', () => {
    expect(firefox.host_permissions).not.toContain('<all_urls>');
  });
});

describe('buildManifest("chrome") parity (FF5-AC2)', () => {
  it('declares a module-type background service worker (no event-page scripts)', () => {
    expect(chrome.background?.service_worker).toBe('src/background/service-worker.ts');
    expect(chrome.background?.type).toBe('module');
    expect(chrome.background?.scripts).toBeUndefined();
  });

  it('declares the full Chrome permission set (incl. offscreen)', () => {
    expect(chrome.permissions).toEqual([
      'activeTab',
      'scripting',
      'contextMenus',
      'storage',
      'notifications',
      'offscreen',
      'cookies',
      'declarativeNetRequestWithHostAccess',
    ]);
  });

  it('ships the DNR ruleset and no Firefox-only gecko block', () => {
    expect(chrome.declarative_net_request).toBeDefined();
    expect(chrome.browser_specific_settings).toBeUndefined();
  });

  it('equals the back-compat exported manifest', () => {
    expect(buildManifest('chrome')).toEqual(manifest);
  });
});

describe('cross-target parity (FF5-AC2): shared fields are identical', () => {
  it('shares identical name / version / description', () => {
    expect(firefox.name).toEqual(chrome.name);
    expect(firefox.version).toEqual(chrome.version);
    expect(firefox.description).toEqual(chrome.description);
  });

  it('shares identical action / options_ui / icons', () => {
    expect(firefox.action).toEqual(chrome.action);
    expect(firefox.options_ui).toEqual(chrome.options_ui);
    expect(firefox.icons).toEqual(chrome.icons);
  });

  it('shares identical host_permissions / optional_host_permissions', () => {
    expect(firefox.host_permissions).toEqual(chrome.host_permissions);
    expect(firefox.optional_host_permissions).toEqual(chrome.optional_host_permissions);
  });

  it('shares the identical DNR network strategy', () => {
    expect(firefox.declarative_net_request).toEqual(chrome.declarative_net_request);
  });
});
