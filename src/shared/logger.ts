/**
 * PII/secret-scrubbing logger (F2-FR2 / I-1).
 *
 * Defense in depth: the password is never passed to a logger in the first place
 * (it stays function-local in the login routine), but any context object logged
 * anywhere is scrubbed of known secret-bearing keys before it reaches the
 * console, so a stray log line can never leak a token/password/authorization.
 * The scrubbing logic is pure and unit-tested; the console write is the only
 * impure line.
 */
import type { Logger, LogLevel } from '@shared/ports';

const SECRET_KEYS = new Set(
  ['password', 'token', 'x-access-token', 'authorization', 's3authorization', 'jwt'].map((k) =>
    k.toLowerCase(),
  ),
);

const REDACTED = '[redacted]';

/** Recursively redact secret-bearing keys from a context object. */
export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(scrub);
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SECRET_KEYS.has(key.toLowerCase()) ? REDACTED : scrub(val);
    }
    return out;
  }
  return value;
}

type Sink = (message: string, context?: Record<string, unknown>) => void;

/** A Logger that scrubs context then forwards to the provided sinks. */
export class ScrubbingLogger implements Logger {
  constructor(
    private readonly sinks: Record<LogLevel, Sink> = {
      // eslint-disable-next-line no-console
      info: (m, c) => (c ? console.warn(m, c) : console.warn(m)),
      warn: (m, c) => (c ? console.warn(m, c) : console.warn(m)),
      error: (m, c) => (c ? console.error(m, c) : console.error(m)),
    },
  ) {}

  info(message: string, context?: Record<string, unknown>): void {
    this.write('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.write('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.write('error', message, context);
  }

  private write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (context === undefined) {
      this.sinks[level](message);
      return;
    }
    this.sinks[level](message, scrub(context) as Record<string, unknown>);
  }
}
