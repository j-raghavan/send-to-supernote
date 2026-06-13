/**
 * XML/XHTML entity escaper (shared) — pure.
 *
 * One home for the five predefined XML entities so the EPUB builder
 * (`epub-builder.ts`) and the provenance header (`provenance.ts`) escape
 * identically (DRY). EPUB content is strict XHTML and the provenance block is
 * injected into it un-normalized, so every interpolated value must be escaped
 * here or a strict reader (MuPDF 1.17 on the Supernote) halts on malformed XML.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
