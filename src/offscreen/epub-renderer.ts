/**
 * EPUB render adapter (F3-FR3, R-6) — THIN offscreen shell.
 *
 * Packs the EPUB file set (built by the covered conversion/epub-builder) into a
 * valid EPUB zip via jszip. The `mimetype` entry is stored uncompressed and
 * first, per the EPUB spec. No structure/decision logic here. Coverage-excluded
 * (architecture §9.3): jszip byte-packing, validated on-device (deferred R-6).
 */
/* c8 ignore start */
import JSZip from 'jszip';
import { buildEpubFiles, type EpubInput } from '../conversion/epub-builder';

/** Build a valid EPUB zip and return its bytes. */
export async function renderEpub(input: EpubInput): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const file of buildEpubFiles(input)) {
    zip.file(file.path, file.content, file.store ? { compression: 'STORE' } : undefined);
  }
  const buffer = await zip.generateAsync({
    type: 'uint8array',
    mimeType: 'application/epub+zip',
  });
  return buffer;
}
/* c8 ignore stop */
