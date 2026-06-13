import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, isCaptureMode, isOutputFormat, isTarget } from '@domain/settings';

describe('settings guards (FP1-FR1)', () => {
  describe('isCaptureMode', () => {
    it('accepts reader', () => {
      expect(isCaptureMode('reader')).toBe(true);
    });

    it('accepts fullpage (FP1-FR1)', () => {
      expect(isCaptureMode('fullpage')).toBe(true);
    });

    it('rejects unknown strings and non-strings', () => {
      expect(isCaptureMode('bogus')).toBe(false);
      expect(isCaptureMode('')).toBe(false);
      expect(isCaptureMode(42)).toBe(false);
      expect(isCaptureMode(null)).toBe(false);
      expect(isCaptureMode(undefined)).toBe(false);
      expect(isCaptureMode({})).toBe(false);
    });
  });

  describe('isOutputFormat', () => {
    it('accepts pdf and epub', () => {
      expect(isOutputFormat('pdf')).toBe(true);
      expect(isOutputFormat('epub')).toBe(true);
    });

    it('rejects unknown values', () => {
      expect(isOutputFormat('txt')).toBe(false);
      expect(isOutputFormat(1)).toBe(false);
      expect(isOutputFormat(null)).toBe(false);
    });
  });

  describe('isTarget', () => {
    it('accepts cloud and privatecloud', () => {
      expect(isTarget('cloud')).toBe(true);
      expect(isTarget('privatecloud')).toBe(true);
    });

    it('rejects unknown values', () => {
      expect(isTarget('local')).toBe(false);
      expect(isTarget(0)).toBe(false);
      expect(isTarget(undefined)).toBe(false);
    });
  });

  it('keeps the default capture mode at reader (FP1-FR1)', () => {
    expect(DEFAULT_SETTINGS.defaultMode).toBe('reader');
  });

  it('defaults includeImages to true (per-send "Include images" on by default)', () => {
    expect(DEFAULT_SETTINGS.includeImages).toBe(true);
  });

  it('defaults includeProvenance to false ("Add source & time" off — privacy-first)', () => {
    expect(DEFAULT_SETTINGS.includeProvenance).toBe(false);
  });
});
