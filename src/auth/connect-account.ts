/**
 * ConnectAccount use case (F2-FR1) — connect the public Supernote Cloud account
 * with email + password via the shared login routine, then persist ONLY the
 * derived token, account, and a stable equipment id (D-2). On failure no token
 * is stored and the error is surfaced (F2-AC3).
 */
import type { Result } from '@shared/result';
import type { ApiProfile } from '@domain/delivery';
import { DEFAULT_PUBLIC_PROFILE } from '@domain/delivery';
import type { CountryCode } from '@domain/auth';
import { type LoginDeps, type LoginError, performLogin } from './login-routine';
import type { StoredAccount, TokenStore } from './token-store';

export interface ConnectDeps extends LoginDeps {
  tokens: TokenStore;
  /** Pinned public-Cloud profile (resolved by the F5-FR1 spike); defaults to the assumption. */
  profile?: ApiProfile;
}

export interface ConnectParams {
  account: string;
  password: string;
  countryCode?: CountryCode;
}

/**
 * Connect the public Cloud account. Reuses any previously-generated equipment id
 * so the client identity is stable across reconnects.
 */
export async function connectAccount(
  deps: ConnectDeps,
  params: ConnectParams,
): Promise<Result<StoredAccount, LoginError>> {
  const existingEquipment = await deps.tokens.getEquipment();
  const result = await performLogin(deps, {
    profile: deps.profile ?? DEFAULT_PUBLIC_PROFILE,
    account: params.account,
    password: params.password,
    ...(params.countryCode !== undefined ? { countryCode: params.countryCode } : {}),
    ...(existingEquipment !== undefined ? { equipment: existingEquipment } : {}),
  });

  if (!result.ok) {
    return result;
  }

  const stored: StoredAccount = {
    token: result.value.token,
    account: params.account,
    equipment: result.value.equipment,
  };
  await deps.tokens.save(stored);
  return { ok: true, value: stored };
}
