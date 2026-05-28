/**
 * Launch a fresh Chrome/Chromium instance with the built extension loaded
 * (the load-unpacked flow), for local development.
 *
 * `npm run dev:chrome` builds dist/ then runs this. For a live loop, also run
 * `npm run dev` (watch) in another terminal — note Chrome does NOT hot-reload
 * MV3 service workers, so after a rebuild click the reload icon on the
 * extension card at chrome://extensions (or re-run this).
 *
 * Uses a dedicated dev profile under the OS temp dir (so your normal Chrome is
 * untouched and the dev profile persists across launches). Override the binary
 * with CHROME_BIN. Set CHROME_LAUNCH_DRYRUN=1 to print the command only.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const distDir = resolve(root, 'dist');

function candidates() {
  if (process.env.CHROME_BIN) return [process.env.CHROME_BIN];
  switch (platform()) {
    case 'darwin':
      return [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ];
    case 'win32':
      return [
        join(
          process.env.PROGRAMFILES ?? 'C:\\Program Files',
          'Google\\Chrome\\Application\\chrome.exe',
        ),
        join(
          process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)',
          'Google\\Chrome\\Application\\chrome.exe',
        ),
      ];
    default:
      return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  }
}

function findChrome() {
  for (const candidate of candidates()) {
    const isPath = candidate.includes('/') || candidate.includes('\\');
    if (!isPath) return candidate; // bare command — rely on PATH
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function main() {
  if (!existsSync(distDir)) {
    console.error(
      'No dist/ found. Run `npm run build:all:dev:chrome` first (dev:chrome does both).',
    );
    process.exit(1);
  }
  const bin = findChrome();
  if (!bin) {
    console.error('Could not find Chrome/Chromium. Set CHROME_BIN to the browser binary path.');
    process.exit(1);
  }
  const profileDir = join(tmpdir(), 'send-to-supernote-dev-profile');
  mkdirSync(profileDir, { recursive: true });
  const args = [
    `--user-data-dir=${profileDir}`,
    `--disable-extensions-except=${distDir}`,
    `--load-extension=${distDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    'chrome://extensions',
  ];

  if (process.env.CHROME_LAUNCH_DRYRUN) {
    console.log([bin, ...args].map((a) => JSON.stringify(a)).join(' '));
    return;
  }

  console.log(`Launching: ${bin}`);
  console.log(`  extension: ${distDir}`);
  console.log(`  dev profile: ${profileDir}`);
  const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
  child.on('error', (err) => {
    console.error(`Failed to launch Chrome: ${err.message}`);
    process.exit(1);
  });
  child.unref();
}

main();
