import { describe, expect, it } from 'vitest';
import {
  NO_THIRD_PARTY,
  PASSWORD_NEVER_STORED,
  PRIVACY_POLICY_URL,
} from '../../../src/options/privacy-copy';

describe('privacy copy (F7-FR5 / F10-FR1)', () => {
  it('provides a Privacy Policy URL (https)', () => {
    expect(PRIVACY_POLICY_URL).toMatch(/^https:\/\//);
  });

  it('states the password is never stored, only a local token (D-2)', () => {
    expect(PASSWORD_NEVER_STORED.toLowerCase()).toContain('never');
    expect(PASSWORD_NEVER_STORED.toLowerCase()).toContain('token');
    expect(PASSWORD_NEVER_STORED.toLowerCase()).toContain('locally');
  });

  it('states no third party / no server we run (D-3)', () => {
    expect(NO_THIRD_PARTY.toLowerCase()).toContain('third party');
  });
});
