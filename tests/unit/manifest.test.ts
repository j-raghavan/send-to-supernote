import { describe, expect, it } from 'vitest';
import { manifest } from '../../manifest.config';

describe('manifest (F1-FR1)', () => {
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
    ]);
  });

  it('does NOT request debugger or identity', () => {
    expect(manifest.permissions).not.toContain('debugger');
    expect(manifest.permissions).not.toContain('identity');
  });

  it('does NOT request declarativeNetRequest variants by default', () => {
    expect(manifest.permissions).not.toContain('declarativeNetRequest');
    expect(manifest.permissions).not.toContain('declarativeNetRequestWithHostAccess');
  });
});

describe('manifest host permissions (F1-FR3)', () => {
  it('declares both candidate public-API hosts statically', () => {
    expect(manifest.host_permissions).toContain('https://cloud.supernote.com/*');
    expect(manifest.host_permissions).toContain('https://viewer.supernote.com/*');
  });

  it("declares Ratta's S3 host for the pre-signed PUT", () => {
    expect(manifest.host_permissions).toContain('https://*.amazonaws.com/*');
  });

  it('never declares <all_urls> as a static host permission', () => {
    expect(manifest.host_permissions).not.toContain('<all_urls>');
  });

  it('declares the Private Cloud origin under optional host permissions (runtime-granted)', () => {
    expect(manifest.optional_host_permissions).toEqual(['http://*/*', 'https://*/*']);
  });
});
