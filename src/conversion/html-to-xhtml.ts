/**
 * HTML -> well-formed XHTML normalization (F3-FR3 hardening).
 *
 * The EPUB chapter document (`epub-builder.ts`) is XML (`<?xml ...?>`) and EPUB
 * readers parse content documents as STRICT XHTML. But Readability's `.content`
 * (and the body-fallback `innerHTML`) is HTML5 serialization, where void
 * elements like `<img>` / `<br>` / `<hr>` are NOT self-closed. Injected verbatim
 * into the chapter, the first such tag makes the document not-well-formed and a
 * strict reader halts there — e.g. `<a><img src="..."></a>` raises "Opening and
 * ending tag mismatch: img and a", and only the content BEFORE the first image
 * renders (the reported "stops after the first few paragraphs").
 *
 * This re-parses the HTML through the DOM (forgiving) and re-serializes it as XML
 * so void elements self-close and text/attribute entities are valid. It uses DOM
 * globals (`DOMParser` / `XMLSerializer`) that exist in the render context (the
 * Chrome offscreen DOM and the Firefox event page) — the conversion layer may use
 * the DOM, just not the extension namespace. happy-dom unit-testable.
 */

// `XMLSerializer.serializeToString(body)` wraps the content in a single
// namespaced <body> element; strip that wrapper so the chapter's own <body>
// (with the XHTML namespace already declared on <html>) hosts the content. The
// xmlns value contains no '>' so `[^>]*` cannot over-match; a self-closed empty
// body (`<body .../>`) is matched by the same open pattern, leaving "".
const BODY_OPEN = /^<body[^>]*>/;
const BODY_CLOSE = /<\/body>$/;

/**
 * Normalize an HTML fragment into a well-formed XHTML fragment suitable for
 * embedding inside an EPUB chapter's <body>. Empty/whitespace input yields "".
 */
export function toXhtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const bodyXml = new XMLSerializer().serializeToString(doc.body);
  return bodyXml.replace(BODY_OPEN, '').replace(BODY_CLOSE, '');
}
