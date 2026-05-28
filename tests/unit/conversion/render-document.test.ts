import { beforeEach, describe, expect, it } from 'vitest';
import { renderDocument } from '../../../src/conversion/render-document';
import type { CapturedDocument } from '@domain/capture';
import { FakeRenderer } from '../../fakes/fake-renderer';

const doc: CapturedDocument = { mode: 'reader', title: 'T', html: '<p>body</p>' };

describe('renderDocument (F3-FR2 / Edge Cases retry-once)', () => {
  let renderer: FakeRenderer;

  beforeEach(() => {
    renderer = new FakeRenderer();
  });

  it('renders a PDF and returns the blob handle + size', async () => {
    const result = await renderDocument({ renderer }, { document: doc, format: 'pdf' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.handle).toBe('handle-1');
      expect(result.value.contentType).toBe('application/pdf');
      expect(result.value.size).toBe(1024);
    }
    expect(renderer.calls[0]!.options.paginate).toBe(true);
  });

  it('passes the chosen page size through to the renderer', async () => {
    await renderDocument({ renderer }, { document: doc, format: 'pdf', pageSize: 'letter' });
    expect(renderer.calls[0]!.options.pageSize).toBe('letter');
  });

  it('renders EPUB with the epub content type and no pagination', async () => {
    const result = await renderDocument({ renderer }, { document: doc, format: 'epub' });
    expect(result.ok && result.value.contentType).toBe('application/epub+zip');
    expect(renderer.calls[0]!.options.paginate).toBe(false);
  });

  it('retries once after a failed render and then succeeds', async () => {
    renderer.failNext = 1;
    const result = await renderDocument({ renderer }, { document: doc, format: 'pdf' });
    expect(result.ok).toBe(true);
    expect(renderer.calls).toHaveLength(1); // one failure (not recorded) + one success
  });

  it('fails with render-failed after two consecutive failures (no empty upload)', async () => {
    renderer.failNext = 2;
    const result = await renderDocument({ renderer }, { document: doc, format: 'pdf' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('render-failed');
    }
    expect(renderer.calls).toHaveLength(0);
  });

  it('inlines images before rendering when a fetcher is provided (F3-FR4)', async () => {
    const withImg: CapturedDocument = {
      mode: 'reader',
      title: 'T',
      html: '<p>x</p><img src="https://ok/a.png">',
    };
    const fetchImage = (url: string): Promise<string> =>
      Promise.resolve(`data:image/png;base64,${btoa(url)}`);
    const result = await renderDocument(
      { renderer, fetchImage },
      { document: withImg, format: 'pdf' },
    );
    expect(result.ok).toBe(true);
    expect(renderer.calls[0]!.html).toContain('data:image/png;base64,');
    expect(renderer.calls[0]!.html).not.toContain('https://ok/a.png');
  });

  it('skips an un-fetchable image but still renders (F3-AC3)', async () => {
    const withImg: CapturedDocument = {
      mode: 'reader',
      title: 'T',
      html: '<p>keep</p><img src="https://blocked/x.png">',
    };
    const fetchImage = (): Promise<undefined> => Promise.resolve(undefined);
    const result = await renderDocument(
      { renderer, fetchImage },
      { document: withImg, format: 'pdf' },
    );
    expect(result.ok).toBe(true);
    expect(renderer.calls[0]!.html).toBe('<p>keep</p>');
  });
});
