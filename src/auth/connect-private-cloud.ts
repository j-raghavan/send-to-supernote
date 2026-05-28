/**
 * ConnectPrivateCloud use case (F7-FR3 / F8-FR1) — connect the user's
 * self-hosted Private Cloud with email + password via the SHARED login routine
 * (F2-FR0) against the user-configured base URL, persisting ONLY the derived JWT
 * plus the base URL and account (never the password — D-2). Base-URL validation
 * happens before this runs (domain/private-cloud-url).
 *
 * The runtime host-permission request for the entered origin (F8-FR1) is the
 * thin adapter's concern; this use case is the pure connect + persist logic.
 */
import { type Result } from '@shared/result';
import type { KeyValueStore } from '@shared/ports';
import { StorageKeys } from '@shared/storage-keys';
import { privateCloudProfile } from '@domain/delivery';
import type { CountryCode } from '@domain/auth';
import { type LoginDeps, type LoginError, performLogin } from './login-routine';

export interface ConnectPrivateCloudDeps extends LoginDeps {
  store: KeyValueStore;
}

export interface ConnectPrivateCloudParams {
  /** A validated, normalized origin (from validateBaseUrl). */
  baseUrl: string;
  account: string;
  password: string;
  countryCode?: CountryCode;
}

export interface PrivateCloudConnection {
  baseUrl: string;
  account: string;
  token: string;
}

/** Connect the Private Cloud server and persist only the JWT + baseUrl + account. */
export async function connectPrivateCloud(
  deps: ConnectPrivateCloudDeps,
  params: ConnectPrivateCloudParams,
): Promise<Result<PrivateCloudConnection, LoginError>> {
  const existingEquipment = await deps.store.get<string>(StorageKeys.equipment);
  const result = await performLogin(deps, {
    profile: privateCloudProfile(params.baseUrl),
    account: params.account,
    password: params.password,
    ...(params.countryCode !== undefined ? { countryCode: params.countryCode } : {}),
    ...(existingEquipment !== undefined ? { equipment: existingEquipment } : {}),
  });

  if (!result.ok) {
    return result;
  }

  await deps.store.set(StorageKeys.privateBaseUrl, params.baseUrl);
  await deps.store.set(StorageKeys.privateAccount, params.account);
  await deps.store.set(StorageKeys.privateToken, result.value.token);

  return {
    ok: true,
    value: { baseUrl: params.baseUrl, account: params.account, token: result.value.token },
  };
}
