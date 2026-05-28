/**
 * Result<T, E> — explicit success/failure without throwing across boundaries.
 *
 * The domain and use cases never throw for expected, recoverable conditions
 * (auth failure, validation, unreachable server); they return a `Result`. This
 * keeps control flow testable and forces call sites to handle the failure path
 * (Security: validate input at boundaries; no silent failures — spec NFR).
 */

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/**
 * Map the success value, leaving an error untouched. Useful for adapting one
 * canonical result shape to another without unwrapping by hand.
 */
export function mapOk<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/**
 * Unwrap the success value or return a provided fallback for the error case.
 */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
