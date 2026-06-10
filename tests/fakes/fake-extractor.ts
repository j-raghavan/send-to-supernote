import type { Extractor } from '@shared/ports';
import type { ReaderExtract } from '@domain/capture';

/**
 * Canned Extractor for the capture use-case tests. Returns a scripted reader
 * extract, or throws to exercise the extraction-failed path.
 */
export class FakeExtractor implements Extractor {
  /** Records the most recent `includeImages` arg so tests can assert it. */
  lastIncludeImages?: boolean;

  constructor(private readonly reader?: ReaderExtract | Error) {}

  extractReader(includeImages: boolean): Promise<ReaderExtract> {
    this.lastIncludeImages = includeImages;
    if (this.reader instanceof Error) return Promise.reject(this.reader);
    if (!this.reader) return Promise.reject(new Error('no reader extract configured'));
    return Promise.resolve(this.reader);
  }
}
