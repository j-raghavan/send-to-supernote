import type { Extractor } from '@shared/ports';
import type { ReaderExtract } from '@domain/capture';

/**
 * Canned Extractor for the capture use-case tests. Returns a scripted reader
 * extract, or throws to exercise the extraction-failed path.
 */
export class FakeExtractor implements Extractor {
  constructor(private readonly reader?: ReaderExtract | Error) {}

  extractReader(): Promise<ReaderExtract> {
    if (this.reader instanceof Error) {
      return Promise.reject(this.reader);
    }
    if (!this.reader) {
      return Promise.reject(new Error('no reader extract configured'));
    }
    return Promise.resolve(this.reader);
  }
}
