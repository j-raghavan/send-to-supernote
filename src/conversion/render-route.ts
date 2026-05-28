/**
 * Render routing (F1-FR5/FR6) — pure decision for which offscreen renderer to
 * use, given the resolved RenderOptions. Keeps the offscreen.ts host a thin
 * dispatcher (it just calls the chosen renderer + stores bytes). Covered.
 */
import type { RenderOptions } from '@domain/conversion';

export type RenderRoute = 'epub' | 'pdf-rasterized' | 'pdf-html';

/**
 * Decide the render route:
 *  - EPUB  -> the jszip EPUB builder/renderer;
 *  - PDF + rasterize (Full Page) -> html2canvas -> paginated PDF;
 *  - PDF (Reader) -> jsPDF .html() layout.
 */
export function renderRoute(options: RenderOptions): RenderRoute {
  if (options.format === 'epub') {
    return 'epub';
  }
  return options.rasterize ? 'pdf-rasterized' : 'pdf-html';
}
