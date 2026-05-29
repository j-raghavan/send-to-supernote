# ADR-0003: Shared login routine + API profile as data (not code)

- Status: accepted
- Date: 2026-05-27
- Deciders: Architect agent

## Context and Problem Statement

Public Cloud and Private Cloud share the **same login flow** (nonce → hash → login) but differ in
base URL, response envelope, and the host/header profile is unknown until the F5-FR1 spike (two
reference hosts: `cloud.supernote.com` vs `viewer.supernote.com`, with different `version`/
`equipmentNo`/`channel` headers — R-8). `countryCode` may need to vary (R-7). How do we avoid
divergent auth code (F2-FR0) and avoid hardcoding breakable host/header facts?

## Decision Drivers

- F2-FR0: one login routine for both targets.
- R-8/R-7: host, headers, and countryCode must be **configurable**, pinned by the spike at runtime.
- Reverse-engineered fields are breakable → keep them as data behind a port.

## Decision Outcome

Chosen: a single `auth/login-routine.ts` parameterized by `(baseUrl, ApiProfile)` returning a token,
never persisting the password. `ApiProfile` (in `domain/delivery.ts`) is a value object holding host,
header set (`version`/`equipmentNo`/`channel` as needed), and `countryCode` (default `"1"`). The
resolved public profile is stored under `supernote.apiHost` (Data Model). The F5-FR1 spike fills in
the profile values; no host/header string is hardcoded in logic. Login hash composition
(`sha256(md5(pwd)+randomCode)`, lowercase hex) is pure domain (`domain/auth.ts`) tested against a
known `bwhitman` vector; the sha256 digest primitive is injected (WebCrypto adapter).

### Consequences

- Good: zero auth-code duplication between F2 and F8; spike outcome is a data change, not a refactor.
- Good: R-8/R-7 handled without rebuilds; an Options countryCode field is added only if the spike
  shows `"1"` fails.
- Bad/Cost: one indirection (profile object) — trivial, and it is the exact seam the spec asks for.

## More Information

`docs/ddd/architecture.md` §6 (F2/F5/F8 rows), §11 (R-7/R-8). Spec Interfaces + R-7/R-8.
