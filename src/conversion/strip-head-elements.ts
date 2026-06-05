/**
 * Strip head-only elements from EPUB body HTML (F3-FR3 hardening).
 *
 * Captured article HTML (Readability over Parsoid/Wikipedia output) can carry
 * head-only elements INSIDE the body — notably `<meta property="mw:PageProp/toc"/>`.
 * The Supernote's EPUB engine (MuPDF 1.17) HALTS HTML parsing at an in-body
 * `<meta>` and silently drops every element after it, collapsing a long article
 * to ~2 pages (reproduced exactly with mutool 1.17: 2 pages / 2.4 KB of text;
 * removing the `<meta>` → 51 pages / 188 KB). This is the same "halt and
 * truncate" failure class as a remote `<img>` (see strip-remote-images.ts), but
 * triggered by a stray head element rather than an unresolved resource. Modern
 * MuPDF tolerates it, so it only reproduces on-device.
 *
 * `<meta>`, `<link>`, `<base>`, and `<title>` are never flow content, so they are
 * removed from the body before packaging. Uses DOM globals (`DOMParser`)
 * available in the render context (Chrome offscreen DOM / Firefox event page);
 * the conversion layer may use the DOM, just not the extension namespace.
 * happy-dom unit-testable. Empty/whitespace input yields "".
 */
export function stripHeadElements(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.body.querySelectorAll('meta, link, base, title').forEach((el) => el.remove());
  return doc.body.innerHTML;
}
