import { describe, expect, it } from 'vitest';
import { err, isErr, isOk, mapOk, ok, unwrapOr } from '@shared/result';

describe('Result', () => {
  it('ok() builds a success result', () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    expect(r.value).toBe(42);
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
  });

  it('err() builds a failure result', () => {
    const r = err('boom');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('boom');
    expect(isErr(r)).toBe(true);
    expect(isOk(r)).toBe(false);
  });

  it('mapOk transforms a success value', () => {
    expect(mapOk(ok(2), (n) => n * 3)).toEqual(ok(6));
  });

  it('mapOk leaves an error untouched', () => {
    const e = err('nope');
    expect(mapOk(e, (n: number) => n * 3)).toBe(e);
  });

  it('unwrapOr returns the value on success', () => {
    expect(unwrapOr(ok('a'), 'fallback')).toBe('a');
  });

  it('unwrapOr returns the fallback on failure', () => {
    expect(unwrapOr(err('x') as never, 'fallback')).toBe('fallback');
  });
});
