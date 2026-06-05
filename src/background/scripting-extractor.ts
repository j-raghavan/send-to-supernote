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
import type { CapturedDocument, ReaderExtract } from '@domain/capture';
import type { ReaderParser } from './reader-parser';
import { api } from '@shared/browser-api';
import { applyInlinedImages } from '@conversion/apply-inline-images';

/**
 * Self-contained page-capture func (Issue 1 / Issue 2). This is serialized into
 * the page by `chrome.scripting.executeScript`, so it MUST reference no bundled
 * import and no outer variable — only plain DOM/canvas globals. It snapshots
 * each already-decoded `<img>` bitmap to a canvas and returns it as a `data:`
 * URI (the only place loaded bitmaps exist), so the offscreen/direct renderer
 * never has to load live (often cross-origin) image URLs.
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
 * permission. The func is async because the retry awaits an image load.
 *
 * `opts.fullPage` selects the returned HTML. Reader (false) returns the whole
 * `documentElement` outerHTML and Readability cleans it off-page. Full Page HTML
 * (true) has NO Readability pass, so this returns a SANITIZED body: a <body>
 * clone with non-content/executable elements removed (script/style/noscript/
 * template/iframe/object/embed/link) and form-control values cleared, so inline
 * script source, CSS text, <head> metadata, and typed/hidden field values never
 * leak into the rendered EPUB/PDF. It returns body innerHTML (not outerHTML) to
 * avoid a double-<body> when the EPUB path re-wraps it.
 */
async function capturePageWithImages(opts: { fullPage: boolean }): Promise<{
  html: string;
  url: string;
  title: string;
  images: { src: string; srcset?: string; dataUri: string }[];
}> {
  const images: { src: string; srcset?: string; dataUri: string }[] = [];
  const seen = new Set<string>();
  let inlinedBytes = 0;
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

    let dataUri: string | undefined;
    try {
      dataUri = encodePng(img, img.naturalWidth, img.naturalHeight);
    } catch {
      // Tainted (cross-origin, loaded without CORS). Retry via an anonymous
      // reload; succeeds only if the host sends Access-Control-Allow-Origin.
      const probe = await loadAnonymous(img.currentSrc || raw);
      if (probe && probe.naturalWidth > 0 && probe.naturalHeight > 0) {
        try {
          dataUri = encodePng(probe, probe.naturalWidth, probe.naturalHeight);
        } catch {
          dataUri = undefined; // host has no CORS → leave remote, skip
        }
      }
    }
    if (dataUri === undefined || !dataUri.startsWith('data:image/')) {
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

  let html: string;
  if (opts.fullPage && document.body) {
    const body = document.body.cloneNode(true) as HTMLElement;
    body
      .querySelectorAll('script,style,noscript,template,iframe,object,embed,link')
      .forEach((el) => el.remove());
    // Drop server-set form value attributes (e.g. hidden CSRF tokens) from the
    // capture, and strip event-handler attributes (inert in a static document).
    body.querySelectorAll('*').forEach((el) => {
      el.removeAttribute('value');
      for (const name of el.getAttributeNames()) {
        if (name.toLowerCase().startsWith('on')) {
          el.removeAttribute(name);
        }
      }
    });
    // Remove comment nodes — they can carry dev tokens/secrets.
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_COMMENT);
    const comments: Node[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      comments.push(node);
    }
    comments.forEach((node) => node.parentNode?.removeChild(node));
    html = body.innerHTML;
  } else {
    html = document.documentElement.outerHTML;
  }

  return {
    html,
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
    const raw = await this.run(capturePageWithImages, { fullPage: false });
    const html = applyInlinedImages(raw.html, raw.images);
    console.warn(`[send-to-supernote] captured html: ${html.length} chars from ${raw.url}`);
    return this.reader.extract(html, raw.url);
  }

  async extractFullPageHtml(): Promise<CapturedDocument> {
    const raw = await this.run(capturePageWithImages, { fullPage: true });
    const html = applyInlinedImages(raw.html, raw.images);
    console.warn(`[send-to-supernote] captured full page: ${html.length} chars from ${raw.url}`);
    return { mode: 'fullpage-html', title: raw.title, html };
  }

  private async run<T, A>(func: (arg: A) => T | Promise<T>, arg: A): Promise<T> {
    // `func` may be async; executeScript awaits its promise and returns the
    // resolved value as `injection.result` (typed as Awaited<...>).
    const [injection] = await api.scripting.executeScript({
      target: { tabId: this.tabId },
      func,
      args: [arg],
    });
    const result = injection?.result;
    if (result === null || result === undefined) {
      throw new Error('Could not read this page (the browser blocked the capture script).');
    }
    return result as T;
  }
}
/* c8 ignore stop */
