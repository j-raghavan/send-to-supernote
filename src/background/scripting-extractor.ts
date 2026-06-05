/**
 * ScriptingExtractor (F3/F4) — Extractor port over chrome.scripting.
 *
 * CRITICAL MV3 constraint: a `func` passed to `chrome.scripting.executeScript`
 * is serialized into the PAGE, so it must be fully self-contained — it canNOT
 * reference any bundled import (those live only in this SW bundle and are
 * undefined in the page). So the page only does what plain DOM can do: capture
 * its rendered HTML (and inline loaded images). Reader needs Readability, which
 * is not in the page, so the raw HTML is handed off-page (offscreen document on
 * Chrome / event page on Firefox) to parse. Coverage-excluded.
 */
/* c8 ignore start */
import type { Extractor } from '@shared/ports';
import type { ReaderExtract } from '@domain/capture';
import type { ReaderParser } from './reader-parser';
import { api } from '@shared/browser-api';
import { applyInlinedImages } from '@conversion/apply-inline-images';

/**
 * Self-contained page-capture func (Issue 1). This is serialized into the page by
 * `chrome.scripting.executeScript`, so it MUST reference no bundled import and no
 * outer variable — only plain DOM/canvas globals. It snapshots each
 * already-decoded `<img>` bitmap to a canvas and returns it as a `data:` URI (the
 * only place loaded bitmaps exist), so the offscreen/direct renderer never has to
 * load live (often cross-origin) image URLs.
 *
 * Encoding is PNG-always (no quality arg, no JPEG): PNG preserves alpha, which
 * matters for e-ink rendering. Caps: skip images over 4 megapixels, and stop
 * inlining once the accumulated data-URI bytes would exceed ~24 MB.
 *
 * Cross-origin handling: a normally-loaded cross-origin `<img>` taints the
 * canvas, so `toDataURL` throws. On that failure we RETRY by reloading the image
 * via `new Image()` with `crossOrigin = 'anonymous'`: this makes the browser do
 * an anonymous (NO cookies) CORS request, so it succeeds — and yields an
 * un-tainted canvas — for any host that sends `Access-Control-Allow-Origin`
 * (Wikipedia/Wikimedia and most CDNs do). Hosts that send no CORS header still
 * taint and are skipped. This never sends credentials and needs no extra
 * permission. The same anonymous reload also DECODES lazy / below-the-fold
 * images that weren't ready at capture time (no scrolling required). The func is
 * async because the reload awaits an image load.
 */
async function capturePageWithImages(): Promise<{
  html: string;
  url: string;
  images: { src: string; srcset?: string; dataUri: string }[];
  skipped: number;
}> {
  const images: { src: string; srcset?: string; dataUri: string }[] = [];
  const seen = new Set<string>();
  let inlinedBytes = 0;
  // Count remote images we WANTED to inline but couldn't (not-yet-decoded/lazy,
  // over the pixel cap, cross-origin without CORS, or past the byte budget) —
  // surfaced in the capture log so partial inlining isn't silent.
  let skipped = 0;
  const MAX_PIXELS = 4_000_000; // >4 megapixels: skip
  const MAX_BYTES = 24_000_000; // ~24 MB total inlined budget

  // Draw a decoded image to a PNG data URI; throws if the canvas is tainted.
  const encodePng = (source: CanvasImageSource, w: number, h: number): string => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('no 2d context');
    }
    ctx.drawImage(source, 0, 0);
    return canvas.toDataURL('image/png'); // PNG-always: preserves alpha
  };

  // Reload a URL with an anonymous (cookie-less) CORS request so a clean,
  // un-tainted canvas is possible for CORS-enabled hosts. Resolves null on error.
  const loadAnonymous = (url: string): Promise<HTMLImageElement | null> =>
    new Promise((resolve) => {
      const probe = new Image();
      probe.crossOrigin = 'anonymous';
      probe.onload = () => resolve(probe);
      probe.onerror = () => resolve(null);
      probe.src = url;
    });

  const overCap = (w: number, h: number): boolean => w * h > MAX_PIXELS;

  // Only <img> elements with a usable `src` are inlined. KNOWN LIMITATIONS
  // (skipped): srcset-only / <picture><source> images and JS lazy-loaders that
  // park the real URL in a data-* attribute (data-src/data-lazy-src/…) behind a
  // SHARED placeholder `src` — the off-page rewrite keys on the `src` attribute,
  // and a shared placeholder would collapse to one key and mis-inline every
  // image, so these are intentionally not handled here. Native loading="lazy"
  // (real URL in `src`) IS handled via the reload below. CSS background-images
  // are also not captured.
  for (const img of Array.from(document.images)) {
    // Key on the RAW attribute value (matches apply-inline-images.ts).
    const raw = img.getAttribute('src');
    if (!raw || raw.startsWith('data:')) {
      continue; // already inline, or srcset-only / data-src-only (no usable src)
    }
    if (seen.has(raw)) {
      continue; // de-dupe identical raw srcs (don't re-encode)
    }

    const decoded = img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
    if (decoded && overCap(img.naturalWidth, img.naturalHeight)) {
      skipped += 1;
      continue;
    }

    let dataUri: string | undefined;
    if (decoded) {
      try {
        dataUri = encodePng(img, img.naturalWidth, img.naturalHeight);
      } catch {
        dataUri = undefined; // tainted → fresh anonymous reload below
      }
    }
    if (dataUri === undefined) {
      // Either NOT yet decoded (native loading="lazy" / below-the-fold) or
      // tainted: reload the real URL fresh and anonymously. This decodes lazy
      // images without scrolling, and for CORS hosts yields an un-tainted canvas.
      // A non-CORS cross-origin image still taints and is skipped.
      const probe = await loadAnonymous(img.currentSrc || raw);
      if (
        probe &&
        probe.naturalWidth > 0 &&
        probe.naturalHeight > 0 &&
        !overCap(probe.naturalWidth, probe.naturalHeight)
      ) {
        try {
          dataUri = encodePng(probe, probe.naturalWidth, probe.naturalHeight);
        } catch {
          dataUri = undefined; // host has no CORS → leave remote, skip
        }
      }
    }
    if (dataUri === undefined || !dataUri.startsWith('data:image/')) {
      skipped += 1; // lazy load failed, no CORS, over the pixel cap, or unencodable
      continue;
    }
    if (inlinedBytes + dataUri.length > MAX_BYTES) {
      skipped += 1;
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
    images,
    skipped,
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
    console.warn(
      `[send-to-supernote] captured html: ${html.length} chars from ${raw.url} ` +
        `(images inlined: ${raw.images.length}, skipped: ${raw.skipped})`,
    );
    return this.reader.extract(html, raw.url);
  }

  private async run<T>(func: () => T | Promise<T>): Promise<T> {
    // `func` may be async; executeScript awaits its promise and returns the
    // resolved value as `injection.result` (typed as Awaited<...>).
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
