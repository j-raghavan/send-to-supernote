/**
 * resolveProvenance (CP3) — pure decision + value builder for the send saga.
 */
import { describe, expect, it } from 'vitest';
import { resolveProvenance } from '@jobs/resolve-provenance';

const NOW = Date.UTC(2026, 4, 28);

describe('resolveProvenance', () => {
  it('builds the value from the page URL, the given instant, and the zone when the toggle is on', () => {
    expect(
      resolveProvenance(
        { includeProvenance: true, page: { url: 'https://example.com/post' } },
        NOW,
        'Europe/Berlin',
      ),
    ).toEqual({
      sourceUrl: 'https://example.com/post',
      capturedAtMs: NOW,
      timeZone: 'Europe/Berlin',
    });
  });

  it('returns undefined when the toggle is off', () => {
    expect(
      resolveProvenance({ includeProvenance: false, page: { url: 'https://x' } }, NOW, 'UTC'),
    ).toBeUndefined();
  });

  it('never stamps a pre-rendered source pass-through, even when on (Non-Goal)', () => {
    expect(
      resolveProvenance(
        { includeProvenance: true, page: { url: 'https://x' }, source: {} },
        NOW,
        'UTC',
      ),
    ).toBeUndefined();
  });

  it('uses an empty source URL when the page URL is unknown (older caller)', () => {
    expect(resolveProvenance({ includeProvenance: true, page: {} }, NOW, 'UTC')).toMatchObject({
      sourceUrl: '',
    });
  });

  it('omits timeZone when the clock cannot resolve one', () => {
    const value = resolveProvenance(
      { includeProvenance: true, page: { url: 'u' } },
      NOW,
      undefined,
    );
    expect(value).toEqual({ sourceUrl: 'u', capturedAtMs: NOW });
    expect(value && 'timeZone' in value).toBe(false);
  });
});
