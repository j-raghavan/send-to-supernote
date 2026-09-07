/**
 * PDF render adapter (F3-FR2) — THIN offscreen DOM shell.
 *
 * Wraps jsPDF's `.html()` to lay out the captured HTML into a paginated PDF and
 * returns the raw bytes. Contains no decision logic (format/options/retry live
 * in the covered RenderDocument use case). Coverage-excluded (architecture
 * §9.3): requires a real DOM + jsPDF.
 */
/* c8 ignore start */
import { jsPDF } from 'jspdf';
import type { PageSize, Provenance } from '@domain/conversion';
import { formatCapturedAt } from '@conversion/provenance';

/** Render HTML to a paginated PDF and return the bytes. */
export async function renderHtmlToPdf(
  html: string,
  pageSize: PageSize,
  provenance?: Provenance,
): Promise<Uint8Array> {
  const doc = new jsPDF({ unit: 'pt', format: pageSize });
  // Provenance file metadata (CP5): jsPDF has no native "source URL" field, so
  // the URL rides in `subject` and the capture time in `keywords`.
  if (provenance) {
    doc.setProperties({
      subject: provenance.sourceUrl,
      keywords: `Captured ${formatCapturedAt(provenance.capturedAtMs, provenance.timeZone)}`,
    });
  }
  const container = document.createElement('div');
  container.innerHTML = html;
  await doc.html(container, {
    autoPaging: 'text',
    margin: 24,
    width: doc.internal.pageSize.getWidth() - 48,
    windowWidth: 800,
  });
  return new Uint8Array(doc.output('arraybuffer'));
}
/* c8 ignore stop */
