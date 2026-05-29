import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { manifest } from '../../../manifest.config';

const PERMISSIONS_DOC = readFileSync(
  fileURLToPath(new URL('../../../docs/PERMISSIONS.md', import.meta.url)),
  'utf8',
);

describe('PERMISSIONS.md justifies every requested permission (F10-FR2 / F10-AC2)', () => {
  it('documents each manifest permission (no undocumented permission)', () => {
    for (const permission of manifest.permissions ?? []) {
      expect(PERMISSIONS_DOC, `permission not justified: ${permission}`).toContain(
        `\`${permission}\``,
      );
    }
  });

  it('documents each static host permission', () => {
    for (const host of manifest.host_permissions ?? []) {
      expect(PERMISSIONS_DOC, `host not justified: ${host}`).toContain(host);
    }
  });

  it('documents the optional host permissions', () => {
    for (const host of manifest.optional_host_permissions ?? []) {
      expect(PERMISSIONS_DOC, `optional host not justified: ${host}`).toContain(host);
    }
  });

  it('records the intentionally-excluded debugger and identity permissions', () => {
    expect(PERMISSIONS_DOC).toContain('`debugger`');
    expect(PERMISSIONS_DOC).toContain('`identity`');
  });
});
