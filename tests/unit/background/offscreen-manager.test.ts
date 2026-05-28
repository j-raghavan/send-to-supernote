import { beforeEach, describe, expect, it } from 'vitest';
import {
  OFFSCREEN_JUSTIFICATION,
  OFFSCREEN_REASONS,
  OFFSCREEN_URL,
  OffscreenManager,
} from '../../../src/background/offscreen-manager';
import { FakeOffscreenHost } from '../../fakes/fake-offscreen-host';

// F1-AC3: exactly one offscreen context is created (with declared reasons) and
// closed after use. The single-instance create/close POLICY is covered here over
// a FakeOffscreenHost; the live Chrome offscreen-context creation + message-
// passing reachability is a MANUAL/runtime gate (see DoD), deferred-to-user.
describe('OffscreenManager (F1-FR5 / F1-AC3 single-instance lifecycle)', () => {
  let host: FakeOffscreenHost;
  let manager: OffscreenManager;

  beforeEach(() => {
    host = new FakeOffscreenHost();
    manager = new OffscreenManager(host);
  });

  it('creates the offscreen document with declared reasons when none exists', async () => {
    const result = await manager.ensure();
    expect(result.ok).toBe(true);
    expect(host.createCalls).toHaveLength(1);
    expect(host.createCalls[0]).toEqual({
      url: OFFSCREEN_URL,
      reasons: OFFSCREEN_REASONS,
      justification: OFFSCREEN_JUSTIFICATION,
    });
  });

  it('declares DOM_PARSER and BLOBS reasons', () => {
    expect(OFFSCREEN_REASONS).toContain('DOM_PARSER');
    expect(OFFSCREEN_REASONS).toContain('BLOBS');
  });

  it('reuses an existing document (never creates a second — single instance)', async () => {
    await manager.ensure();
    const second = await manager.ensure();
    expect(second.ok).toBe(true);
    expect(host.createCalls).toHaveLength(1);
  });

  it('retries creation once after a failure', async () => {
    host.failCreations = 1;
    const result = await manager.ensure();
    expect(result.ok).toBe(true);
    // one failed attempt + one successful attempt
    expect(host.createCalls).toHaveLength(1);
  });

  it('fails with create-failed after two consecutive failures', async () => {
    host.failCreations = 2;
    const result = await manager.ensure();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('create-failed');
    }
    expect(host.createCalls).toHaveLength(0);
  });

  it('closes the document on release when one exists', async () => {
    await manager.ensure();
    await manager.release();
    expect(host.closeCalls).toBe(1);
  });

  it('release is a no-op when no document exists', async () => {
    await manager.release();
    expect(host.closeCalls).toBe(0);
  });
});
