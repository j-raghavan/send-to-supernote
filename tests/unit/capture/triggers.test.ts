import { describe, expect, it } from 'vitest';
import {
  captureModeForMenuItem,
  MENU_FULLPAGE,
  MENU_ITEMS,
  MENU_READER,
} from '../../../src/capture/triggers';

describe('capture triggers (F4-FR1 / F6-FR2)', () => {
  it('defines a Send menu item mapped to reader mode', () => {
    expect(MENU_READER.title).toContain('Send to Supernote');
    expect(MENU_READER.mode).toBe('reader');
    expect(MENU_READER.contexts).toEqual(['page']);
  });

  it('defines a Full Page menu item mapped to fullpage mode (FP1-FR2)', () => {
    expect(MENU_FULLPAGE.id).toBe('send-to-supernote-fullpage');
    expect(MENU_FULLPAGE.title).toBe('Send to Supernote (Full Page)');
    expect(MENU_FULLPAGE.mode).toBe('fullpage');
    expect(MENU_FULLPAGE.contexts).toEqual(['page']);
  });

  it('exposes both the Reader and Full Page items (FP1-FR2)', () => {
    expect(MENU_ITEMS).toHaveLength(2);
    expect(MENU_ITEMS).toContain(MENU_READER);
    expect(MENU_ITEMS).toContain(MENU_FULLPAGE);
  });

  it('resolves the Send menu id to reader mode', () => {
    expect(captureModeForMenuItem(MENU_READER.id)).toBe('reader');
  });

  it('resolves the Full Page menu id to fullpage mode (FP1-FR2)', () => {
    expect(captureModeForMenuItem('send-to-supernote-fullpage')).toBe('fullpage');
  });

  it('returns undefined for an unknown menu id', () => {
    expect(captureModeForMenuItem('something-else')).toBeUndefined();
  });
});
