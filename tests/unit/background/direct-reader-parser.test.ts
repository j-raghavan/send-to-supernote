// @vitest-environment happy-dom
/**
 * DirectReaderParser (FF2-FR4, FF2-AC5, I-F7) — the Firefox reader-parse adapter.
 *
 * It is pure delegation: `extract(html, url)` must call the shared
 * `parseReader(html, url)` from `render-parse-core` and return its result
 * verbatim, holding NO copy of the parse logic. We mock `parseReader` at the
 * module boundary to prove the call shape + verbatim return (no inline logic),
 * and add one real-delegation check that the result equals `parseReader`'s.
 * happy-dom is needed because the real `parseReader` uses DOMParser/document.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReaderExtract } from '@domain/capture';

const parseReader = vi.fn<(html: string, url: string) => ReaderExtract>();
vi.mock('@conversion/render-parse-core', () => ({
  parseReader: (html: string, url: string) => parseReader(html, url),
}));

import { DirectReaderParser } from '../../../src/background/direct-reader-parser';

describe('DirectReaderParser (FF2-FR4 / FF2-AC5 delegation)', () => {
  afterEach(() => {
    parseReader.mockReset();
  });

  it('delegates extract(html, url) to parseReader with the same args', async () => {
    const expected: ReaderExtract = { title: 'T', content: '<p>c</p>', length: 42 };
    parseReader.mockReturnValue(expected);

    const result = await new DirectReaderParser().extract('<p>html</p>', 'https://ex.com/a');

    expect(parseReader).toHaveBeenCalledTimes(1);
    expect(parseReader).toHaveBeenCalledWith('<p>html</p>', 'https://ex.com/a');
    // Returned verbatim (same object reference) — proves no inline post-processing.
    expect(result).toBe(expected);
  });

  it('resolves to a Promise of the ReaderExtract (port is async)', async () => {
    parseReader.mockReturnValue({ title: 'X', content: '', length: 0 });
    const promise = new DirectReaderParser().extract('<p>h</p>', 'https://ex.com/b');
    expect(promise).toBeInstanceOf(Promise);
    await expect(promise).resolves.toEqual({ title: 'X', content: '', length: 0 });
  });
});
