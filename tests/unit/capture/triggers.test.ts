import { describe, expect, it } from 'vitest';
import {
  captureModeForMenuItem,
  MENU_FULLPAGE,
  MENU_ITEMS,
  MENU_READER,
} from '../../../src/capture/triggers';

describe('capture triggers (F4-FR1 / F6-FR2)', () => {
  it('defines a Reader View menu item mapped to reader mode', () => {
    expect(MENU_READER.title).toContain('Reader View');
    expect(MENU_READER.mode).toBe('reader');
    expect(MENU_READER.contexts).toEqual(['page']);
  });

  it('defines a Full Page menu item mapped to fullpage mode', () => {
    expect(MENU_FULLPAGE.title).toContain('Full Page');
    expect(MENU_FULLPAGE.mode).toBe('fullpage');
  });

  it('exposes both items', () => {
    expect(MENU_ITEMS).toHaveLength(2);
  });

  it('resolves the Full Page menu id to fullpage mode', () => {
    expect(captureModeForMenuItem(MENU_FULLPAGE.id)).toBe('fullpage');
  });

  it('resolves the Reader menu id to reader mode', () => {
    expect(captureModeForMenuItem(MENU_READER.id)).toBe('reader');
  });

  it('returns undefined for an unknown menu id', () => {
    expect(captureModeForMenuItem('something-else')).toBeUndefined();
  });
});
