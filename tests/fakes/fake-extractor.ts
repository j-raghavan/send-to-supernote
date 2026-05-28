import type { Extractor } from '@shared/ports';
import type { FullPageExtract, ReaderExtract } from '@domain/capture';

/**
 * Canned Extractor for the capture use-case tests. Returns scripted reader /
 * full-page extracts, or throws to exercise the extraction-failed path.
 */
export class FakeExtractor implements Extractor {
  constructor(
    private readonly reader?: ReaderExtract | Error,
    private readonly fullPage?: FullPageExtract | Error,
  ) {}

  extractReader(): Promise<ReaderExtract> {
    if (this.reader instanceof Error) {
      return Promise.reject(this.reader);
    }
    if (!this.reader) {
      return Promise.reject(new Error('no reader extract configured'));
    }
    return Promise.resolve(this.reader);
  }

  serializeFullPage(): Promise<FullPageExtract> {
    if (this.fullPage instanceof Error) {
      return Promise.reject(this.fullPage);
    }
    if (!this.fullPage) {
      return Promise.reject(new Error('no full-page extract configured'));
    }
    return Promise.resolve(this.fullPage);
  }
}
