/**
 * Package the built `dist/` directory into a loadable, distributable zip
 * artifact (F1-FR4). Uses the bundled `jszip` (already a dependency) so no
 * extra tooling and no CDN/remote code (F10-FR4).
 */
import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const root = fileURLToPath(new URL('..', import.meta.url));
const distDir = join(root, 'dist');
const outDir = join(root, 'artifacts');

async function addDir(zip, dir, base) {
  const entries = await readdir(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) {
      await addDir(zip, full, base);
    } else {
      const rel = relative(base, full);
      zip.file(rel, await readFile(full));
    }
  }
}

async function main() {
  if (!existsSync(distDir)) {
    console.error('No dist/ directory found. Run `npm run build` first.');
    process.exit(1);
  }
  const zip = new JSZip();
  await addDir(zip, distDir, distDir);
  if (!existsSync(outDir)) {
    await mkdir(outDir, { recursive: true });
  }
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const outPath = join(outDir, 'send-to-supernote.zip');
  await writeFile(outPath, bytes);
  console.log(`Wrote ${outPath} (${bytes.length} bytes)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
