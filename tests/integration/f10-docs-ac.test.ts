/**
 * F10 privacy/security/Web-Store readiness — AC-traceability doc-gate tests.
 *
 * Like the F5-FR1 spike-doc check, these assert the shipped docs exist and state
 * the load-bearing facts accurately to the implemented behavior, and re-assert
 * the structural guards as the release gate:
 *
 *  - F10-AC1: a Privacy Policy URL is present and the policy content is accurate
 *             (token-only, client-only, no third party, no identity/OAuth).
 *  - F10-AC2: every manifest permission/host is justified in PERMISSIONS.md, no
 *             unused permission, and the excluded debugger/identity are recorded.
 *  - F10-AC3: no runtime remote-code loads and no chrome.storage.sync secret
 *             writes (the structural guards, re-asserted at the F10 gate).
 *  - F10-AC4: SECURITY-REVIEW describes token-only + client-only flow WITH the
 *             network-audit evidence (F5-AC5 / F8-AC5).
 *
 * Pure doc + manifest + source scans; no network/DOM.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { manifest } from '../../manifest.config';
import { PRIVACY_POLICY_URL } from '../../src/options/privacy-copy';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const doc = (name: string): string => readFileSync(join(ROOT, 'docs', name), 'utf8');

describe('F10-AC1 — Privacy Policy present + accurate to behavior', () => {
  const privacy = doc('PRIVACY.md');

  it('pins a Privacy Policy URL consistent with the in-code constant', () => {
    expect(PRIVACY_POLICY_URL).toMatch(/^https:\/\/\S+$/);
    expect(privacy).toContain(PRIVACY_POLICY_URL);
  });

  it('states token-only storage and that the password is never stored (D-2)', () => {
    const lower = privacy.toLowerCase();
    expect(lower).toContain('password is never stored');
    expect(lower).toContain('chrome.storage.local');
    expect(lower).toContain('no `chrome.storage.sync`'.toLowerCase());
  });

  it('states the client-only, zero-third-party data flow (D-3) and no OAuth/identity', () => {
    const lower = privacy.toLowerCase();
    expect(lower).toContain('no third-party providers');
    expect(lower).toContain('no server operated by this project');
    expect(lower).toContain('no third-party oauth');
    expect(lower).toContain('no telemetry');
    expect(privacy).toContain('`identity`');
  });
});

describe('F10-AC2 — every permission/host justified, none unused', () => {
  const permissions = doc('PERMISSIONS.md');

  it('justifies each manifest permission', () => {
    for (const permission of manifest.permissions ?? []) {
      expect(permissions, `undocumented permission: ${permission}`).toContain(`\`${permission}\``);
    }
  });

  it('justifies each static + optional host permission', () => {
    for (const host of manifest.host_permissions ?? []) {
      expect(permissions, `undocumented host: ${host}`).toContain(host);
    }
    for (const host of manifest.optional_host_permissions ?? []) {
      expect(permissions, `undocumented optional host: ${host}`).toContain(host);
    }
  });

  it('records the excluded debugger and identity permissions', () => {
    expect(permissions).toContain('`debugger`');
    expect(permissions).toContain('`identity`');
  });
});

describe('F10-AC3 — no runtime remote code + no chrome.storage.sync secret writes', () => {
  const SRC = join(ROOT, 'src');

  function files(dir: string, ext: RegExp): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        out.push(...files(full, ext));
      } else if (ext.test(entry) && !entry.endsWith('.d.ts')) {
        out.push(full);
      }
    }
    return out;
  }

  function strip(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  }

  it('no HTML ships a remote <script src> and no TS does a remote import()', () => {
    const remoteScript: string[] = [];
    const remoteImport: string[] = [];
    for (const file of files(SRC, /\.(ts|html)$/)) {
      const raw = readFileSync(file, 'utf8');
      if (file.endsWith('.html') && /<script\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\//i.test(raw)) {
        remoteScript.push(file.replace(SRC, 'src'));
      }
      if (file.endsWith('.ts') && /\bimport\s*\(\s*["'](?:https?:)?\/\//i.test(strip(raw))) {
        remoteImport.push(file.replace(SRC, 'src'));
      }
    }
    expect(remoteScript).toEqual([]);
    expect(remoteImport).toEqual([]);
  });

  it('no source references chrome.storage.sync / storage.sync (I-5)', () => {
    const offenders: string[] = [];
    for (const file of files(SRC, /\.ts$/)) {
      if (/chrome\.storage\.sync|storage\.sync/.test(strip(readFileSync(file, 'utf8')))) {
        offenders.push(file.replace(SRC, 'src'));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('F10-AC4 — SECURITY-REVIEW describes token-only + client-only with network evidence', () => {
  const review = doc('SECURITY-REVIEW.md');

  it('describes the token-only credential lifecycle (D-2 / I-1)', () => {
    const lower = review.toLowerCase();
    expect(lower).toContain('token-only');
    expect(lower).toContain('never');
    expect(review).toContain('chrome.storage.local');
    expect(review).toContain('isAuthFailure'); // 401 ≡ E0401 handling
  });

  it('describes the zero-intermediary flow WITH the F5-AC5 / F8-AC5 network evidence', () => {
    expect(review).toContain('F5-AC5');
    expect(review).toContain('F8-AC5');
    expect(review).toContain('reader-to-cloud.test.ts');
    expect(review).toContain('private-cloud-send.test.ts');
    expect(review.toLowerCase()).toContain('zero-intermediary');
  });

  it('records the no-remote-code guarantee and the HTTP-over-LAN consideration', () => {
    expect(review).toContain('no-remote-code.test.ts');
    expect(review.toLowerCase()).toContain('http-over-lan');
    expect(review).toContain('sole-fetch.test.ts');
  });
});
