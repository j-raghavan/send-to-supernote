# F5-FR1 — Public Cloud integration spike (host / header / countryCode)

- **Status:** **RESOLVED (auth leg) 2026-05-28** — host + path + countryCode pinned against a real account. Apply→PUT→finish + on-device sync still to confirm with a real send.
- **Feature:** F5-FR1 (gating, end-to-end integration spike).
- **Last updated:** 2026-05-28

## RESULT (live run, 2026-05-28)

Run with a real account via `curl` (credentials used in-shell only, never stored/committed):

| Host | `POST /api/official/user/query/random/code` |
|---|---|
| `cloud.supernote.com` | **HTTP 403** `{"error":"CSRF token validation failed","code":"CSRF_TOKEN_EXPIRED"}` |
| `cloud.supernote.com.cn` | **HTTP 403** (same CSRF error) |
| `viewer.supernote.com` | **HTTP 200** `{"success":true,"randomCode":"…","timestamp":…}` ✅ |

**Pinned facts:**
- **Host = `viewer.supernote.com`.** `cloud.supernote.com` is now CSRF-gated (R-1 materialized) and unusable for the plain API flow.
- **Path prefix = `/api`** for public too (not `''`): `viewer.supernote.com/official/...` → **404**; `viewer.supernote.com/api/official/...` → **200**. (Earlier `pathPrefix: ''` was a latent bug — mocked tests didn't catch it.)
- **`countryCode: "1"` works** for this email account (R-7 closed for this account).
- **No extra headers needed** — `version`/`equipmentNo`/`channel` were NOT required for nonce or login (`viewer` worked with just `Content-Type: application/json`).
- **Login → token confirmed:** `sha256(md5(pwd)+randomCode)` (lowercase hex) → `POST /api/official/user/account/login/new` returned `{"success":true,"errorCode":null,"token":"…"(205 chars)}`. Envelope is `{success, errorCode, errorMsg, token}` as specified.

**Applied to code:** `DEFAULT_PUBLIC_PROFILE` → `viewer.supernote.com` + `pathPrefix: '/api'` + no extra headers; `DEFAULT_PUBLIC_HOST = 'viewer'`; `cloud.supernote.com` kept as the CSRF-gated `CLOUD_PUBLIC_PROFILE` fallback.

## STILL TO CONFIRM (needs a real send / device)
- [ ] `apply → PUT(S3) → finish` for an actual file upload (only nonce+login were exercised; the upload step + S3 PUT headers are unverified live).
- [ ] On-device sync: the uploaded file appears and opens on a real Supernote.

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
  - `DEFAULT_PUBLIC_PROFILE` (`viewer.supernote.com`, `/api`, no extra headers) — pinned by the live run.
  - `CLOUD_PUBLIC_PROFILE` (`cloud.supernote.com`, `/api`) — the CSRF-gated fallback (R-8/R-1).
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

- [x] Which host the account accepts — **`viewer.supernote.com`** (cloud is CSRF-gated); no extra headers needed. *(2026-05-28)*
- [x] Whether `countryCode: "1"` works — **yes** for this account (R-7). *(2026-05-28)*
- [x] `login` leg (nonce → hash → login → token) completes — **confirmed**. *(2026-05-28)*
- [ ] `apply → PUT → finish` completes end-to-end (the upload leg + S3 PUT headers) — needs a real send.
- [ ] Whether any `declarativeNetRequest` header tweak is needed for the S3 `PUT`
      (not expected; reserve the permission only if so).
- [ ] On-device confirmation that the synced file opens on a Supernote.

The extension now defaults to `viewer.supernote.com` + `/api` + `countryCode: "1"`
(pinned by the live run); `cloud.supernote.com` remains as an overridable fallback.
