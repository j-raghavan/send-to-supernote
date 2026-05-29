/**
 * Package a built extension directory into a loadable, distributable zip
 * artifact (F1-FR4, FF6-FR4). Uses the bundled `jszip` (already a dependency) so
 * no extra tooling and no CDN/remote code (F10-FR4).
 *
 * Browser-agnostic: pass the target as the first CLI arg.
 *   node scripts/zip-artifact.mjs           -> dist/         -> send-to-supernote-<ver>.zip
 *   node scripts/zip-artifact.mjs firefox   -> dist-firefox/ -> send-to-supernote-firefox-<ver>.zip
 */
import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = process.argv[2] === 'firefox' ? 'firefox' : 'chrome';
const distDir = join(root, target === 'firefox' ? 'dist-firefox' : 'dist');
const outDir = join(root, 'artifacts');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
// Chrome keeps the historical UNVERSIONED name `send-to-supernote.zip` —
// .github/workflows/release.yml versions it via a `cp` step, so do not change it
// here. Firefox is a new artifact and carries the version in its name directly.
const zipName =
  target === 'firefox' ? `send-to-supernote-firefox-${version}.zip` : 'send-to-supernote.zip';

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
    const buildCmd = target === 'firefox' ? 'npm run build:firefox' : 'npm run build';
    console.error(`No ${relative(root, distDir)}/ directory found. Run \`${buildCmd}\` first.`);
    process.exit(1);
  }
  const zip = new JSZip();
  await addDir(zip, distDir, distDir);
  if (!existsSync(outDir)) {
    await mkdir(outDir, { recursive: true });
  }
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const outPath = join(outDir, zipName);
  await writeFile(outPath, bytes);
  console.log(`Wrote ${outPath} (${bytes.length} bytes)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
