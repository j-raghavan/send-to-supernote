import { describe, expect, it } from 'vitest';
import { buildManifest, manifest } from '../../manifest.config';

// F1-AC1 (load in Chrome with no manifest errors + toolbar icon appears) is a
// MANUAL/runtime install gate — see DoD. These assertions pin the manifest SHAPE
// that gate depends on (MV3, SW, toolbar action, options, icons); the live
// "loads in Chrome stable with zero console errors" check is deferred-to-user.
describe('manifest (F1-FR1 / F1-AC1 manifest shape)', () => {
  it('declares Manifest V3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('declares a module-type background service worker', () => {
    expect(manifest.background?.service_worker).toBe('src/background/service-worker.ts');
    expect(manifest.background?.type).toBe('module');
  });

  it('declares a toolbar action with a title', () => {
    expect(manifest.action?.default_title).toBe('Send to Supernote');
  });

  it('declares an options page', () => {
    expect(manifest.options_ui?.page).toBe('src/options/options.html');
  });

  it('declares icons', () => {
    expect(manifest.icons).toBeDefined();
    expect(manifest.icons?.[128]).toBe('icons/icon128.png');
  });
});

describe('manifest permissions (F1-FR2 / F1-AC2)', () => {
  it('declares exactly the least-privilege permission set', () => {
    expect(manifest.permissions).toEqual([
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

  it('does NOT request debugger or identity', () => {
    expect(manifest.permissions).not.toContain('debugger');
    expect(manifest.permissions).not.toContain('identity');
  });

  it('uses the host-scoped DNR variant (not the broad declarativeNetRequest) to strip Origin (F5-FR1 spike)', () => {
    expect(manifest.permissions).toContain('declarativeNetRequestWithHostAccess');
    expect(manifest.permissions).not.toContain('declarativeNetRequest');
    expect(manifest.declarative_net_request?.rule_resources?.[0]?.path).toBe('dnr-rules.json');
  });

  it('F10-FR6: identity is absent in both required and optional permissions (no third-party OAuth)', () => {
    expect(manifest.permissions).not.toContain('identity');
    expect(manifest.optional_permissions ?? []).not.toContain('identity');
  });
});

describe('manifest host permissions (F1-FR3)', () => {
  // The x-access-token session cookie is set on the APEX `.supernote.com`, whose
  // chrome.cookies read-permission url is `https://supernote.com/`. Both the apex
  // and the subdomain wildcard must be granted (apex => cookie is readable;
  // wildcard => the file API host viewer.supernote.com stays covered) on BOTH
  // targets, or Cloud connect silently fails.
  it('grants the apex + wildcard supernote hosts on both Chrome and Firefox', () => {
    for (const m of [buildManifest('chrome'), buildManifest('firefox')]) {
      expect(m.host_permissions).toContain('https://supernote.com/*');
      expect(m.host_permissions).toContain('https://*.supernote.com/*');
    }
  });

  it("declares Ratta's S3 host for the pre-signed PUT (both targets)", () => {
    for (const m of [buildManifest('chrome'), buildManifest('firefox')]) {
      expect(m.host_permissions).toContain('https://*.amazonaws.com/*');
    }
  });

  it('never declares <all_urls> as a static host permission', () => {
    expect(manifest.host_permissions).not.toContain('<all_urls>');
  });

  it('declares the Private Cloud origin under optional host permissions (runtime-granted)', () => {
    expect(manifest.optional_host_permissions).toEqual(['http://*/*', 'https://*/*']);
  });
});
