import type { Logger, LogLevel } from '@shared/ports';

export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

/** Logger that records every entry so tests can assert no secret was logged. */
export class RecordingLogger implements Logger {
  readonly entries: LogEntry[] = [];

  info(message: string, context?: Record<string, unknown>): void {
    this.record('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.record('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.record('error', message, context);
  }

  /** The full serialized log, for substring assertions (e.g. no password). */
  serialized(): string {
    return JSON.stringify(this.entries);
  }

  private record(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    this.entries.push(context === undefined ? { level, message } : { level, message, context });
  }
}
