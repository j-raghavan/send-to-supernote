/**
 * Strip ALL images from captured HTML (per-send "Include images" off).
 * Unlike stripRemoteImages (which keeps self-contained data: images for EPUB
 * safety), this removes every <img>, <picture>, and <source> (data: AND remote)
 * because the user chose a text-only send. DOMParser-based, happy-dom unit-
 * testable, no chrome.* (the conversion layer may use the DOM).
 */
export function stripImages(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.body.querySelectorAll('img, picture, source').forEach((el) => el.remove());
  return doc.body.innerHTML;
}
