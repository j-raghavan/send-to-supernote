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
