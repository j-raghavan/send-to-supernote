import { describe, expect, it } from 'vitest';
import {
  CHROME_CAPTURE_DELAY_MS,
  FIREFOX_CAPTURE_DELAY_MS,
  MAX_TILE_RETRIES,
  captureDelayMs,
} from '../../../src/capture/fullpage-throttle';

describe('fullpage-throttle constants (FP3-FR2/FR3)', () => {
  it('pins the Chrome inter-capture delay to 500 ms', () => {
    expect(CHROME_CAPTURE_DELAY_MS).toBe(500);
  });

  it('pins the Firefox inter-capture delay to 600 ms', () => {
    expect(FIREFOX_CAPTURE_DELAY_MS).toBe(600);
  });

  it('retries a failed tile exactly once', () => {
    expect(MAX_TILE_RETRIES).toBe(1);
  });
});

describe('captureDelayMs (FP3-FR2)', () => {
  it('returns the Chrome delay for the chrome target', () => {
    expect(captureDelayMs('chrome')).toBe(500);
  });

  it('returns the Firefox delay for the firefox target', () => {
    expect(captureDelayMs('firefox')).toBe(600);
  });
});
