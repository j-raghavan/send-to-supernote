import type { Extractor } from '@shared/ports';
import type { CapturedDocument, ReaderExtract } from '@domain/capture';

/**
 * Canned Extractor for the capture use-case tests. Returns a scripted reader
 * extract and/or a scripted full-page document, or throws to exercise the
 * extraction-failed paths.
 */
export class FakeExtractor implements Extractor {
  constructor(
    private readonly reader?: ReaderExtract | Error,
    private readonly fullPage?: CapturedDocument | Error,
  ) {}

  extractReader(): Promise<ReaderExtract> {
    if (this.reader instanceof Error) return Promise.reject(this.reader);
    if (!this.reader) return Promise.reject(new Error('no reader extract configured'));
    return Promise.resolve(this.reader);
  }

  extractFullPageHtml(): Promise<CapturedDocument> {
    if (this.fullPage instanceof Error) return Promise.reject(this.fullPage);
    if (!this.fullPage) return Promise.reject(new Error('no full-page document configured'));
    return Promise.resolve(this.fullPage);
  }
}
