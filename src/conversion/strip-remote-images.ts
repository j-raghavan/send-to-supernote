/**
 * Strip remote image resources from EPUB body HTML (F3-FR3 hardening).
 *
 * An EPUB content document must be self-contained: every embedded resource it
 * references (images, media) has to be packaged in the EPUB, OR the referencing
 * manifest item must declare `properties="remote-resources"`. We package no
 * images and declare no remote resources, so a captured `<img>` pointing at a
 * remote URL (e.g. Readability keeps an article's lead image as
 * `https://…/photo.jpg.webp` with a remote `srcset`) is an undeclared remote
 * resource. A strict, offline e-reader (the Supernote) halts rendering the
 * chapter at that point — so when the image sits a few paragraphs in, only the
 * text BEFORE it survives and the rest of the article is silently dropped (the
 * reported "only copies the first eight paragraphs"). The chapter is still
 * well-formed XML, so the void-element normalization (`toXhtml`) cannot catch
 * this; it is a resource-resolution failure, not a parse error.
 *
 * Remote images cannot render on an offline device anyway, so we drop them and
 * keep the text flowing. Self-contained `data:` images are inlined bytes (no
 * external dependency) and are KEPT. Uses DOM globals (`DOMParser`) available in
 * the render context (Chrome offscreen DOM / Firefox event page); the conversion
 * layer may use the DOM, just not the extension namespace. happy-dom unit-testable.
 */

/** A resource reference is self-contained only when it is an inline `data:` URI. */
function isInlineData(value: string | null): boolean {
  return (value ?? '').trim().toLowerCase().startsWith('data:');
}

/**
 * Remove `<img>`/`<source>` elements that reference a remote (non-`data:`)
 * resource from an HTML fragment. Inline `data:` images are kept (their remote
 * responsive `srcset` candidates, if any, are dropped so a reader cannot prefer
 * a remote source). Empty/whitespace input yields "".
 */
export function stripRemoteImages(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');

  // <source> (inside <picture>) only ever carries remote responsive candidates
  // for our captures; collapse the <picture> down to its <img> by removing them.
  doc.body.querySelectorAll('source').forEach((el) => el.remove());

  doc.body.querySelectorAll('img').forEach((el) => {
    if (isInlineData(el.getAttribute('src'))) {
      el.removeAttribute('srcset');
      return;
    }
    el.remove();
  });

  return doc.body.innerHTML;
}
