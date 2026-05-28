/**
 * Pack the built `dist/` directory into a signed CRX3 for self-hosting / manual
 * install / QA distribution (release.yml).
 *
 * NOTE: the Chrome Web Store submission uses the ZIP (`npm run zip`), not a CRX
 * — the store re-signs. A CRX is only needed for self-hosted/off-store install,
 * so this step is optional and runs in CI only when a signing key is provided.
 *
 * Signing key (one of):
 *   - CRX_PRIVATE_KEY : PEM contents (RSA private key) — used in CI (a secret)
 *   - CRX_KEY_PATH    : path to a PEM file              — used locally
 * Output: CRX_OUT (default artifacts/send-to-supernote.crx)
 * Input dir: CRX_DIST_DIR (default dist)
 *
 * Generate a key locally with: `openssl genrsa 2048 > key.pem` (keep it secret;
 * the key determines the extension ID — never commit it).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ChromeExtension from 'crx';

const root = fileURLToPath(new URL('..', import.meta.url));
const distDir = resolve(root, process.env.CRX_DIST_DIR ?? 'dist');
const outPath = resolve(root, process.env.CRX_OUT ?? 'artifacts/send-to-supernote.crx');

function loadPrivateKey() {
  const inline = process.env.CRX_PRIVATE_KEY;
  if (inline && inline.trim()) return Buffer.from(inline, 'utf8');
  const keyPath = process.env.CRX_KEY_PATH;
  if (keyPath && existsSync(keyPath)) return readFileSync(keyPath);
  console.error(
    'No signing key. Set CRX_PRIVATE_KEY (PEM contents) or CRX_KEY_PATH (PEM file path).',
  );
  process.exit(1);
}

async function main() {
  if (!existsSync(distDir)) {
    console.error(`No dist directory at "${distDir}". Run \`npm run build\` first.`);
    process.exit(1);
  }
  const crx = new ChromeExtension({ privateKey: loadPrivateKey() });
  const loaded = await crx.load(distDir);
  const buffer = await loaded.pack();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buffer);
  console.log(`Wrote ${outPath} (${buffer.length} bytes)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
