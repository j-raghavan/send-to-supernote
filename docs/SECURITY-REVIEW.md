# Security Self-Review — Send to Supernote

- **Last updated:** 2026-05-28
- **Scope:** credential lifecycle (both targets), zero-intermediary data flow with
  network-audit evidence, the HTTP-over-LAN consideration, and the known
  structural-guard residuals.

## 1. Credential lifecycle — token-only (D-2 / I-1)

Both targets share one login routine (`auth/login-routine.ts`, F2-FR0):

1. The **password** is read into a function-local, used only to compute
   `sha256(md5(password) + randomCode)` (lowercase hex, `domain/auth.loginHash`),
   and is **never** returned, persisted, or logged. The login-call body sends the
   hash, never the plaintext.
2. On success, only the derived token is persisted to `chrome.storage.local`:
   - public Cloud → `supernote.token` (+ `supernote.account`, `supernote.equipment`);
   - Private Cloud → `privatecloud.token` (a JWT; + `privatecloud.baseUrl`/`account`).
3. There is **no auto-relogin**. On an auth failure — a transport `401` **or** a
   `success:false` / `errorCode:"E0401"` envelope at HTTP 200 (`domain/delivery
   .isAuthFailure`, treated equivalently) — the token is cleared, a "session
   expired" state is set, and Options is reopened **with the account prefilled**
   (F2-FR4). The password is never auto-resubmitted (none is stored).
4. **Disconnect** removes the target's credential keys (and clears its pending
   jobs). **No `chrome.storage.sync`** is ever used for any secret (I-5).

Evidence: `tests/unit/auth/*`, `tests/unit/shared/logger.test.ts` (a recording
logger asserts no secret reaches a log line), and the secret-absence assertions
in `connect-account.test.ts` / `connect-private-cloud.test.ts`.

## 2. Zero-intermediary data flow (D-3 / I-2)

Page content is converted **locally** (offscreen document; no server-side render)
and uploaded **only** to the user's chosen target. There is **one** network seam
— the `HttpClient` port, implemented solely by `background/fetch-http-client.ts`
(the only `fetch` in the source tree; structurally enforced by
`tests/unit/guards/sole-fetch.test.ts`). No project backend, no telemetry, no
third-party OAuth (no `identity` permission).

**Network-audit evidence:**

- **F5-AC5 (public Cloud):** the integration test
  `tests/integration/reader-to-cloud.test.ts` runs capture → render → apply →
  PUT → finish and asserts every destination host is `cloud.supernote.com` or
  Ratta's S3 (`*.amazonaws.com`) — nothing else.
- **F8-AC5 (Private Cloud):** `tests/integration/private-cloud-send.test.ts` and
  the adapter destination-audit test assert every destination is **only** the
  user's configured base URL — no Ratta server, no third party.

> Live network captures against real accounts/devices are a deferred-to-user step
> (no credentials available here); the mocked-network audits above pin the
> destination invariant in code.

## 3. No runtime remote code (F10-FR4)

All conversion libraries (`@mozilla/readability`, `jspdf`, `jszip` — plus
`html2canvas`, which `jspdf.html()` pulls in transitively) are bundled by Vite
and imported by module specifier — never fetched at runtime. Enforced by
`tests/unit/guards/no-remote-code.test.ts` (no remote `<script src>`, no URL
`import()`).

## 4. HTTP-over-LAN for Private Cloud (R-10)

Self-hosted servers are commonly reached at `http://<lan-ip>:8080`. Over plain
HTTP the hashed-password login payload and the JWT transit unencrypted on the
local network (the **plaintext password is never on the wire** — it is hashed —
but the hash and token are). This is acceptable on a trusted LAN; the Options UI
surfaces a non-HTTPS warning (`domain/private-cloud-url.httpWarningFor`, F8-FR7)
and recommends an HTTPS reverse proxy. The extension still permits HTTP since LAN
self-hosting is the common, user-accepted case.

Conversely, when the user DOES use HTTPS, TLS validation is enforced and **cannot
be bypassed** by an extension `fetch` (there is no `rejectUnauthorized:false`
equivalent — that would let any extension MITM): a self-signed certificate must
be trusted at the OS/browser level, or the connection fails. A network-layer
failure (no HTTP status) therefore surfaces an actionable hint
(`domain/private-cloud-url.privateCloudNetworkErrorHint`) that leads with
reachability and, for HTTPS, appends the certificate-trust and `http://…:19072`
guidance — used by the popup connect, the Options connect, and the send-time
adapter so connect and send stay equally diagnosable.

## 5. Reverse-engineered-API + shared-auth risk (R-1 / R-9)

Both paths use non-contractual endpoints and **share the same login flow**, so an
auth-scheme change would break both targets (R-9). The public→private fallback
(F9-FR2) therefore covers only public-**endpoint** issues, never auth, and only
for self-hosters; per-path feature flags (F9-FR4) bound an endpoint change's blast
radius. Documented in `delivery/fallback.ts` citing the spec.

## 6. Known structural-guard residuals (accepted limitations)

The two filesystem-scan guards (sole-fetch, no-storage-sync) are tripwires, not
proofs. Two bypasses are **accepted** and out of scope for v0.1:

1. **Qualified `fetch`:** the sole-fetch guard now also rejects
   `globalThis.fetch(` / `window.fetch(` / `self.fetch(` (F10-FR5 hardening), but
   an exotic dynamic form (e.g. `const f = globalThis['fet'+'ch']; f(...)`) would
   evade a static scan. Accepted: code review + the single-adapter convention
   cover this; no such code exists.
2. **Bracket `chrome.storage` access:** the no-sync guard matches
   `chrome.storage.sync` / `storage.sync` (dotted). A bracket form
   (`chrome.storage["sync"]`) would evade it. Accepted: the storage adapter is
   the only file that touches `chrome.storage` (pinned to `.local`), verified by
   review; no bracket access exists.

These are tripwires to catch accidental regressions, backed by the
single-adapter architecture and review — not a sandbox.
