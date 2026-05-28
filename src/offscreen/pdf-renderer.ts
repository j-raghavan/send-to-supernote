/**
 * PDF render adapter (F3-FR2 / F4-FR2) — THIN offscreen DOM shell.
 *
 * Wraps jsPDF's `.html()` to rasterize/lay out the captured HTML into a
 * paginated PDF and returns the raw bytes. Contains no decision logic
 * (format/options/retry live in the covered RenderDocument use case).
 * Coverage-excluded (architecture §9.3): requires a real DOM + jsPDF.
 */
/* c8 ignore start */
import { jsPDF } from 'jspdf';
import type { PageSize } from '@domain/conversion';

/** Render HTML to a paginated PDF and return the bytes. */
export async function renderHtmlToPdf(html: string, pageSize: PageSize): Promise<Uint8Array> {
  const doc = new jsPDF({ unit: 'pt', format: pageSize });
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

/**
 * Place a rasterized canvas into a paginated PDF, slicing tall content into
 * page-height tiles (Full Page, F4-FR2/FR3). Returns the PDF bytes.
 */
export function renderCanvasToPdf(canvas: HTMLCanvasElement, pageSize: PageSize): Uint8Array {
  const doc = new jsPDF({ unit: 'pt', format: pageSize });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const imgHeight = (canvas.height * pageWidth) / canvas.width;
  let remaining = imgHeight;
  let position = 0;
  const dataUrl = canvas.toDataURL('image/png');
  while (remaining > 0) {
    doc.addImage(dataUrl, 'PNG', 0, position, pageWidth, imgHeight);
    remaining -= pageHeight;
    if (remaining > 0) {
      position -= pageHeight;
      doc.addPage();
    }
  }
  return new Uint8Array(doc.output('arraybuffer'));
}
/* c8 ignore stop */
