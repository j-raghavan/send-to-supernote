/**
 * PDF-page probe (F6) — is the active tab already a document?
 *
 * Chrome's built-in viewer reports `document.contentType === "application/pdf"`
 * (the URL often has no `.pdf` extension, e.g. arXiv). When it is, the send
 * uploads the bytes as-is — there is nothing to capture or convert. The title
 * derivation is pure and covered; the scripting/HTTP glue is coverage-excluded
 * (architecture §9.3) like the rest of the service-worker adapters.
 */
import type { HttpClient } from '@shared/ports';
import { api } from '@shared/browser-api';

export interface PdfSource {
  bytes: Uint8Array;
  title: string;
}

/** Derive a document title from a PDF URL's last path segment ('document' fallback). */
export function pdfTitleFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '');
    const last = path.slice(path.lastIndexOf('/') + 1);
    return (last || 'document').replace(/\.pdf$/i, '');
  } catch {
    return 'document';
  }
}

/* c8 ignore start */
/**
 * Detect a PDF page and fetch its bytes. The send click grants `activeTab` host
 * access, so the SW may fetch the active tab's URL. Returns undefined for normal
 * HTML pages; throws when the PDF cannot be downloaded.
 */
export async function probePdf(tabId: number, http: HttpClient): Promise<PdfSource | undefined> {
  const [injection] = await api.scripting.executeScript({
    target: { tabId },
    func: () => ({ contentType: document.contentType, url: location.href, title: document.title }),
  });
  const info = injection?.result as
    | { contentType?: string; url?: string; title?: string }
    | undefined;
  if (info?.contentType !== 'application/pdf' || !info.url) {
    return undefined;
  }
  const downloaded = await http.getBytes(info.url);
  if (downloaded.bytes === undefined) {
    throw new Error(`Could not download the PDF (HTTP ${downloaded.status}).`);
  }
  const title = info.title && info.title.trim().length > 0 ? info.title : pdfTitleFromUrl(info.url);
  return { bytes: downloaded.bytes, title };
}
/* c8 ignore stop */
