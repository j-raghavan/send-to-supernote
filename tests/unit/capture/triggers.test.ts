import { describe, expect, it } from 'vitest';
import { captureModeForMenuItem, MENU_ITEMS, MENU_READER } from '../../../src/capture/triggers';

describe('capture triggers (F4-FR1 / F6-FR2)', () => {
  it('defines a Send menu item mapped to reader mode', () => {
    expect(MENU_READER.title).toContain('Send to Supernote');
    expect(MENU_READER.mode).toBe('reader');
    expect(MENU_READER.contexts).toEqual(['page']);
  });

  it('exposes the single Send item', () => {
    expect(MENU_ITEMS).toHaveLength(1);
  });

  it('resolves the Send menu id to reader mode', () => {
    expect(captureModeForMenuItem(MENU_READER.id)).toBe('reader');
  });

  it('returns undefined for an unknown menu id', () => {
    expect(captureModeForMenuItem('something-else')).toBeUndefined();
  });
});
