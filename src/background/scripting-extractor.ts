/**
 * ScriptingExtractor (F3/F4) — Extractor port over chrome.scripting.
 *
 * CRITICAL MV3 constraint: a `func` passed to `chrome.scripting.executeScript`
 * is serialized into the PAGE, so it must be fully self-contained — it canNOT
 * reference any bundled import (those live only in this SW bundle and are
 * undefined in the page). So the page only does what plain DOM can do: return
 * its rendered HTML. Full Page needs nothing more. Reader needs Readability,
 * which is not in the page, so the raw HTML is handed to the offscreen document
 * (which has a DOM + bundled Readability) to parse. Coverage-excluded.
 */
/* c8 ignore start */
import type { Extractor } from '@shared/ports';
import type { ReaderExtract } from '@domain/capture';
import type { ReaderParser } from './reader-parser';
import { api } from '@shared/browser-api';
import { applyInlinedImages } from '@conversion/apply-inline-images';

/**
 * Self-contained page-capture func (Issue 1). This is serialized into the page
 * by `chrome.scripting.executeScript`, so it MUST reference no bundled import
 * and no outer variable — only plain DOM/canvas globals. It snapshots each
 * already-decoded `<img>` bitmap to a canvas and returns it as a `data:` URI
 * (the only place loaded bitmaps exist), so the offscreen/direct renderer never
 * has to load live (often cross-origin) image URLs.
 *
 * Encoding is PNG-always (no quality arg, no JPEG): PNG preserves alpha, which
 * matters for e-ink rendering. Caps: skip images over 4 megapixels, and stop
 * inlining once the accumulated data-URI bytes would exceed ~24 MB. Cross-origin
 * canvas taint throws on drawImage/toDataURL — caught per image and skipped,
 * never aborting the whole capture.
 */
function capturePageWithImages(): {
  html: string;
  url: string;
  title: string;
  images: { src: string; srcset?: string; dataUri: string }[];
} {
  const images: { src: string; srcset?: string; dataUri: string }[] = [];
  const seen = new Set<string>();
  let inlinedBytes = 0;
  const MAX_PIXELS = 4_000_000; // >4 megapixels: skip
  const MAX_BYTES = 24_000_000; // ~24 MB total inlined budget

  for (const img of Array.from(document.images)) {
    // Key on the RAW attribute value (matches apply-inline-images.ts).
    const raw = img.getAttribute('src');
    if (!raw || raw.startsWith('data:')) {
      continue; // already inline, or srcset-only (no src)
    }
    if (seen.has(raw)) {
      continue; // de-dupe identical raw srcs (don't re-encode)
    }
    // Lazy/undecoded guard: only encode fully-loaded, non-zero bitmaps.
    if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) {
      continue;
    }
    if (img.naturalWidth * img.naturalHeight > MAX_PIXELS) {
      continue;
    }

    let dataUri: string;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        continue;
      }
      ctx.drawImage(img, 0, 0);
      dataUri = canvas.toDataURL('image/png'); // PNG-always: preserves alpha
    } catch {
      continue; // cross-origin taint (SecurityError) → skip this image
    }
    if (!dataUri.startsWith('data:image/')) {
      continue;
    }
    if (inlinedBytes + dataUri.length > MAX_BYTES) {
      break; // 24 MB budget reached: stop inlining
    }

    inlinedBytes += dataUri.length;
    seen.add(raw);
    const srcset = img.getAttribute('srcset') || undefined;
    images.push({ src: raw, dataUri, ...(srcset ? { srcset } : {}) });
  }

  return {
    html: document.documentElement.outerHTML,
    url: document.baseURI,
    title: document.title,
    images,
  };
}

export class ScriptingExtractor implements Extractor {
  constructor(
    private readonly tabId: number,
    private readonly reader: ReaderParser,
  ) {}

  async extractReader(): Promise<ReaderExtract> {
    // Self-contained page capture (no bundled imports) that also inlines loaded
    // image bitmaps, then inline them into the HTML and parse off-page.
    const raw = await this.run(capturePageWithImages);
    const html = applyInlinedImages(raw.html, raw.images);
    console.warn(`[send-to-supernote] captured html: ${html.length} chars from ${raw.url}`);
    return this.reader.extract(html, raw.url);
  }

  private async run<T>(func: () => T): Promise<T> {
    const [injection] = await api.scripting.executeScript({
      target: { tabId: this.tabId },
      func,
    });
    const result = injection?.result;
    if (result === null || result === undefined) {
      throw new Error('Could not read this page (the browser blocked the capture script).');
    }
    return result as T;
  }
}
/* c8 ignore stop */
