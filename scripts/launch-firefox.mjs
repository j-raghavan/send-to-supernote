/**
 * Launch a fresh Firefox instance with the built extension loaded as a
 * temporary add-on, for local development (FF6-FR5).
 *
 * Mirrors `launch-chrome.mjs`, but Firefox has a first-class dev flow via
 * Mozilla's `web-ext run`, so this is simpler: `web-ext` installs/launches a
 * clean Firefox, side-loads `dist-firefox/` as a temporary add-on, and watches
 * for reloads. (Firefox event pages DO hot-reload, unlike Chrome MV3 SWs.)
 *
 * `npm run build:firefox` first, then `npm run launch:firefox`. Override the
 * binary with `WEB_EXT_FIREFOX` (web-ext's own env var) or pass `--firefox` via
 * `WEB_EXT_ARGS`. Set `FIREFOX_LAUNCH_DRYRUN=1` to print the command only.
 */
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sourceDir = resolve(root, 'dist-firefox');

function main() {
  if (!existsSync(sourceDir)) {
    console.error('No dist-firefox/ found. Run `npm run build:firefox` first.');
    process.exit(1);
  }

  // Invoke the locally-installed web-ext CLI (devDependency) without assuming a
  // global install. Extra args can be appended via WEB_EXT_ARGS (space-split).
  const extra = (process.env.WEB_EXT_ARGS ?? '').split(' ').filter(Boolean);
  const args = ['web-ext', 'run', '--source-dir', sourceDir, ...extra];

  if (process.env.FIREFOX_LAUNCH_DRYRUN) {
    console.log(['npx', ...args].map((a) => JSON.stringify(a)).join(' '));
    return;
  }

  console.log(`Launching Firefox via web-ext against ${sourceDir} …`);
  const child = spawn('npx', args, { stdio: 'inherit' });
  child.on('error', (err) => {
    console.error(`Failed to launch web-ext: ${err.message}`);
    console.error('Is `web-ext` installed? Run `npm install` (it is a devDependency).');
    process.exit(1);
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

main();
