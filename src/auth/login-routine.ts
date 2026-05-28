/**
 * Shared login routine (F2-FR0) — one nonce → hash → login sequence for BOTH
 * targets, parameterized by `(profile, account, password)` (ADR-0003).
 *
 * Returns only the derived token; the password is a function-local that is
 * never persisted, logged, or returned (I-1 / D-2 / F2-FR2). The server-provided
 * `timestamp` from the nonce step is echoed back on login to avoid clock-skew
 * failures (spec Edge Cases).
 */
import type { HttpClient, RandomSource } from '@shared/ports';
import { err, ok, type Result } from '@shared/result';
import { type ApiProfile, endpointUrl, normalizeEnvelope } from '@domain/delivery';
import {
  type CountryCode,
  DEFAULT_COUNTRY_CODE,
  loginHash,
  type Sha256Hex,
  type Token,
} from '@domain/auth';

export const NONCE_PATH = '/official/user/query/random/code';
export const LOGIN_PATH = '/official/user/account/login/new';

export type LoginErrorKind = 'auth-failed' | 'unexpected-response';

export interface LoginError {
  kind: LoginErrorKind;
  /** Application error code from the envelope (e.g. E0401), when present. */
  errorCode?: string;
  message: string;
}

export interface LoginSuccess {
  token: Token;
  /** The equipment id generated for this login (persisted by the caller, not PII). */
  equipment: string;
}

export interface LoginDeps {
  http: HttpClient;
  sha256hex: Sha256Hex;
  random: RandomSource;
}

export interface LoginParams {
  profile: ApiProfile;
  account: string;
  password: string;
  countryCode?: CountryCode;
  /** Reuse an existing equipment id (stable client id); generated if absent. */
  equipment?: string;
}

interface NoncePayload {
  randomCode?: unknown;
  timestamp?: unknown;
}

/**
 * Execute the nonce → hash → login flow against the given profile. The
 * `password` is read, hashed, and discarded within this function scope.
 */
export async function performLogin(
  deps: LoginDeps,
  params: LoginParams,
): Promise<Result<LoginSuccess, LoginError>> {
  const { http, sha256hex, random } = deps;
  const countryCode = params.countryCode ?? DEFAULT_COUNTRY_CODE;
  const equipment = params.equipment ?? random.uuid();

  // 1. Nonce.
  const nonceRes = await http.request({
    url: endpointUrl(params.profile, NONCE_PATH),
    method: 'POST',
    headers: buildHeaders(params.profile),
    body: { countryCode, account: params.account },
  });
  const nonceEnv = normalizeEnvelope(nonceRes.json);
  const nonce = nonceEnv.payload as NoncePayload;
  if (!nonceEnv.success || typeof nonce.randomCode !== 'string') {
    return err(toError(nonceEnv.errorCode, nonceEnv.errorMsg, 'nonce request failed'));
  }
  const randomCode = nonce.randomCode;
  const timestamp = typeof nonce.timestamp === 'number' ? nonce.timestamp : undefined;

  // 2. Hash (password used transiently, never retained).
  const hashed = await loginHash(params.password, randomCode, sha256hex);

  // 3. Login.
  const loginRes = await http.request({
    url: endpointUrl(params.profile, LOGIN_PATH),
    method: 'POST',
    headers: buildHeaders(params.profile),
    body: {
      countryCode,
      account: params.account,
      password: hashed,
      browser: 'Chrome',
      equipment,
      equipmentNo: equipment,
      loginMethod: '1',
      ...(timestamp !== undefined ? { timestamp } : {}),
      language: 'en',
    },
  });
  const loginEnv = normalizeEnvelope(loginRes.json);
  const token = loginEnv.payload.token;
  if (!loginEnv.success || typeof token !== 'string' || token.length === 0) {
    const kind: LoginErrorKind =
      loginEnv.errorCode === 'E0401' ? 'auth-failed' : 'unexpected-response';
    return err({
      kind,
      ...(loginEnv.errorCode !== undefined ? { errorCode: loginEnv.errorCode } : {}),
      message: loginEnv.errorMsg ?? 'login failed',
    });
  }

  return ok({ token, equipment });
}

function buildHeaders(profile: ApiProfile): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (profile.headers.version !== undefined) {
    headers.version = profile.headers.version;
  }
  if (profile.headers.equipmentNo !== undefined) {
    headers.equipmentNo = profile.headers.equipmentNo;
  }
  if (profile.headers.channel !== undefined) {
    headers.channel = profile.headers.channel;
  }
  return headers;
}

function toError(
  errorCode: string | undefined,
  errorMsg: string | undefined,
  fallback: string,
): LoginError {
  return {
    kind: errorCode === 'E0401' ? 'auth-failed' : 'unexpected-response',
    ...(errorCode !== undefined ? { errorCode } : {}),
    message: errorMsg ?? fallback,
  };
}
