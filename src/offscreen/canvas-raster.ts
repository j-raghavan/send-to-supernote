/**
 * Canvas rasterization adapter (F4-FR2/FR4) — THIN offscreen DOM shell.
 *
 * Rasterizes the serialized full-page HTML to a canvas via html2canvas
 * (best-effort layout capture, R-3). Cross-origin images that taint the canvas
 * are handled by html2canvas's `useCORS`/skip behavior — a tainted image is
 * omitted, never aborting the capture (F4-FR4). No decision logic here.
 * Coverage-excluded (architecture §9.3): requires a real DOM + html2canvas.
 */
/* c8 ignore start */
import html2canvas from 'html2canvas';

/** Rasterize an HTML container element to a canvas (best-effort). */
export function rasterizeToCanvas(element: HTMLElement): Promise<HTMLCanvasElement> {
  return html2canvas(element, {
    useCORS: true,
    // A tainted/failed image is logged and skipped by html2canvas, not thrown,
    // so the capture continues (F4-FR4).
    logging: false,
  });
}
/* c8 ignore stop */
