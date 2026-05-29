/**
 * Render routing (F1-FR5/FR6) — pure decision for which offscreen renderer to
 * use, given the resolved RenderOptions. Keeps the offscreen.ts host a thin
 * dispatcher (it just calls the chosen renderer + stores bytes). Covered.
 */
import type { RenderOptions } from '@domain/conversion';

export type RenderRoute = 'epub' | 'pdf-html';

/**
 * Decide the render route:
 *  - EPUB -> the jszip EPUB builder/renderer;
 *  - PDF  -> jsPDF .html() layout of the captured HTML.
 */
export function renderRoute(options: RenderOptions): RenderRoute {
  return options.format === 'epub' ? 'epub' : 'pdf-html';
}
