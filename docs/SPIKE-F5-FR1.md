# F5-FR1 — Public Cloud integration spike (host / header / countryCode)

- **Status:** Code path shipped (configurable); **live run DEFERRED to the user.**
- **Feature:** F5-FR1 (gating, end-to-end integration spike).
- **Last updated:** 2026-05-28

## What this spike is

F5-FR1 requires empirically validating the full **login → apply → PUT → finish**
flow from a real MV3 service worker against a real Supernote account, and pinning:

1. the working API **host + header profile** — `cloud.supernote.com` vs
   `viewer.supernote.com` with `version`/`equipmentNo`/`channel` (R-8);
2. the **`countryCode`** — reference clients hardcode `"1"` (US); email/international
   accounts may need a different value or `null` (R-7);
3. token / **`E0401`** behaviour (auth failure surfaces as `success:false` +
   `errorCode:"E0401"` at HTTP 200, not necessarily a transport 401);
4. the **S3 `PUT` headers** (`Authorization`, `x-amz-date`,
   `x-amz-content-sha256: UNSIGNED-PAYLOAD`, `Content-Type`).

It is an **integration spike, not a CORS spike**: an MV3 service worker with
`host_permissions` performs cross-origin `fetch()` with custom headers directly
and is **not** subject to page-style CORS preflight blocking. `declarativeNetRequest`
is therefore optional and intentionally omitted (F1-FR2) unless a specific S3 PUT
header proves problematic.

## What is shipped as code (this run)

The breakable facts are modeled as **data, not code** (ADR-0003), so pinning the
spike outcome is a config change, not a refactor:

- `domain/delivery.ts`
  - `ApiProfile` — `{ baseUrl, pathPrefix, headers: {version?, equipmentNo?, channel?}, usesCodeEnvelope }`.
  - `DEFAULT_PUBLIC_PROFILE` (`cloud.supernote.com`, no extra headers) — the working assumption.
  - `VIEWER_PUBLIC_PROFILE` (`viewer.supernote.com`, `version: 202407`) — the R-8 alternative.
  - `resolvePublicProfile(host)` — picks the profile for the pinned host (`'cloud' | 'viewer'`).
  - The resolved choice is persisted under `supernote.apiHost` (Data Model).
- `domain/auth.ts` — `CountryCode` with `DEFAULT_COUNTRY_CODE = "1"` (R-7); an Options
  country field is added only if the live run shows `"1"` fails.
- `auth/login-routine.ts` — already parameterized by `(profile, …)`; the login body
  echoes the server-provided nonce `timestamp` (clock-skew safe).
- `background/fetch-http-client.ts` — the SOLE `fetch`; an MV3 service worker uses it
  with `host_permissions`, no relay (D-3).

All paths are covered by **mocked** unit/integration tests (`FakeHttpClient`),
including both `cloud` and `viewer` profiles, the `E0401` envelope, and a
destination audit (only `cloud.supernote.com` + Ratta S3 are contacted).

## Deferred to the user (live, requires real credentials + device)

The following CANNOT be run here (no account, no device, must not touch the user's
data) and are deferred, to be recorded back into this doc + the README when done:

- [ ] Which host the account accepts (`cloud` vs `viewer`) and the exact
      `version`/`equipmentNo`/`channel` header set.
- [ ] Whether `countryCode: "1"` works, or an Options country field is required (R-7).
- [ ] That `login → apply → PUT → finish` completes end-to-end from the service worker.
- [ ] Whether any `declarativeNetRequest` header tweak is needed for the S3 `PUT`
      (not expected; reserve the permission only if so).
- [ ] On-device confirmation that the synced file opens on a Supernote.

Until the live run is recorded, the extension uses `DEFAULT_PUBLIC_PROFILE`
(`cloud`) and `countryCode: "1"`, both overridable without a rebuild.
