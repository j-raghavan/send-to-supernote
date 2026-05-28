import { describe, expect, it, vi } from 'vitest';
import { ScrubbingLogger, scrub } from '@shared/logger';
import type { LogLevel } from '@shared/ports';

describe('scrub (F2-FR2 / I-1)', () => {
  it('redacts password, token, and authorization keys', () => {
    const out = scrub({
      account: 'a@b.com',
      password: 'hunter2',
      token: 'tok',
      Authorization: 'AWS ...',
    }) as Record<string, unknown>;
    expect(out.account).toBe('a@b.com');
    expect(out.password).toBe('[redacted]');
    expect(out.token).toBe('[redacted]');
    expect(out.Authorization).toBe('[redacted]');
  });

  it('redacts case-insensitively (x-access-token, JWT, s3Authorization)', () => {
    const out = scrub({
      'X-Access-Token': 't',
      JWT: 'j',
      s3Authorization: 's',
    }) as Record<string, unknown>;
    expect(out['X-Access-Token']).toBe('[redacted]');
    expect(out.JWT).toBe('[redacted]');
    expect(out.s3Authorization).toBe('[redacted]');
  });

  it('recurses into nested objects and arrays', () => {
    const out = scrub({ body: { creds: [{ password: 'p' }] } }) as Record<string, unknown>;
    const body = out.body as Record<string, unknown>;
    const creds = body.creds as Array<Record<string, unknown>>;
    expect(creds[0]!.password).toBe('[redacted]');
  });

  it('passes through primitives unchanged', () => {
    expect(scrub('hello')).toBe('hello');
    expect(scrub(42)).toBe(42);
    expect(scrub(null)).toBe(null);
  });
});

describe('ScrubbingLogger', () => {
  function recordingSinks(): {
    sinks: Record<LogLevel, (m: string, c?: Record<string, unknown>) => void>;
    calls: Array<{ level: LogLevel; message: string; context?: Record<string, unknown> }>;
  } {
    const calls: Array<{ level: LogLevel; message: string; context?: Record<string, unknown> }> =
      [];
    const make =
      (level: LogLevel) =>
      (message: string, context?: Record<string, unknown>): void => {
        calls.push(context === undefined ? { level, message } : { level, message, context });
      };
    return { sinks: { info: make('info'), warn: make('warn'), error: make('error') }, calls };
  }

  it('scrubs context before forwarding to the sink (never logs a password)', () => {
    const { sinks, calls } = recordingSinks();
    const logger = new ScrubbingLogger(sinks);
    logger.info('login attempt', { account: 'a@b.com', password: 'SECRET' });
    expect(calls[0]!.context!.password).toBe('[redacted]');
    expect(JSON.stringify(calls)).not.toContain('SECRET');
  });

  it('forwards each level to its sink and supports a context-free call', () => {
    const { sinks, calls } = recordingSinks();
    const logger = new ScrubbingLogger(sinks);
    logger.info('i');
    logger.warn('w', { token: 't' });
    logger.error('e');
    expect(calls.map((c) => c.level)).toEqual(['info', 'warn', 'error']);
    expect(calls[0]!.context).toBeUndefined();
    expect(calls[1]!.context!.token).toBe('[redacted]');
  });

  it('defaults to console sinks that never receive a raw secret', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = new ScrubbingLogger();
    // Exercise both the context-present and context-free branch of every sink.
    logger.info('plain');
    logger.info('info-ctx', { token: 'SECRET' });
    logger.warn('warn-plain');
    logger.warn('warn-ctx', { password: 'SECRET' });
    logger.error('boom');
    logger.error('error-ctx', { jwt: 'SECRET' });
    expect(warnSpy).toHaveBeenCalledWith('plain');
    expect(warnSpy).toHaveBeenCalledWith('warn-plain');
    expect(warnSpy).toHaveBeenCalledWith('info-ctx', { token: '[redacted]' });
    expect(warnSpy).toHaveBeenCalledWith('warn-ctx', { password: '[redacted]' });
    expect(errorSpy).toHaveBeenCalledWith('boom');
    expect(errorSpy).toHaveBeenCalledWith('error-ctx', { jwt: '[redacted]' });
    expect(JSON.stringify([...warnSpy.mock.calls, ...errorSpy.mock.calls])).not.toContain('SECRET');
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
