# Send to Supernote

A Manifest V3 Chrome extension that captures the current web page, converts it to
a PDF (or EPUB) **entirely on your device**, and delivers it to your Supernote
(Ratta) tablet — either via the public Supernote Cloud or your own self-hosted
Supernote Private Cloud. A single toolbar click or right-click sends the page;
the file appears on the tablet after the device runs its next sync (timing is
user/network-dependent, not real-time). Inspired by reMarkable's "Read on
reMarkable", but the conversion happens client-side (Ratta has no conversion
service).

## Capture modes

- **Reader View** — extracts the article with Mozilla Readability (on a _clone_
  of the page, never mutating it) and renders a clean, reflow-friendly,
  **paginated PDF** (or a reflowable **EPUB**). Recommended for text. If a page
  isn't an article, you get an actionable "try Full Page" message instead of an
  empty document.
- **Full Page** — a **best-effort** capture of the rendered page via
  `html2canvas` → paginated PDF. Layout is preserved as far as client-side
  rasterization allows; this is explicitly best-effort fidelity (R-3) — a
  server-side high-fidelity render is a deferred phase, not part of this MVP.

## Delivery targets

Both targets are inside the Supernote ecosystem; there is **no third-party
bridge** (no Dropbox/Drive).

- **Supernote Cloud (primary)** — the reverse-engineered upload flow: `login →
apply → PUT bytes to the pre-signed S3 URL Supernote's API issues → finish`.
  Serves all users.
- **Supernote Private Cloud (alternative, self-hosted)** — upload to _your own_
  server at a base URL you configure (e.g. `http://192.168.x.x:8080` on a LAN, or
  an HTTPS reverse-proxy host). The flow differs only in the upload step:
  `apply (with timestamp + nonce headers) → multipart POST of the file to the
upload URL the apply step returns (commonly /api/oss/upload — never hardcoded)
→ finish`. Uses the same login as public Cloud and stores a **JWT only**.

A send is "done" **only after `finish` reports success**; an applied-but-not-
finished upload is treated as a failure.

## Credentials & data flow

- **Token-only storage (D-2).** Only the derived access token (a JWT for Private
  Cloud) is persisted, in `chrome.storage.local` (never `chrome.storage.sync`).
  Your **password is never stored or logged** — it's used in memory only to
  compute the login hash, then discarded. On an expired/invalid token
  (`401` _or_ the application-level `E0401` envelope at HTTP 200) you're
  re-prompted; there is no silent re-login.
- **Zero-intermediary, no third party (D-3).** Page content is converted locally
  and uploaded **only** to your chosen target — `cloud.supernote.com` (+ Ratta's
  own S3) or your own Private Cloud server. No server operated by this project is
  in the path, there is **no third-party OAuth** (no `identity` permission), and
  there is no telemetry or analytics.

## Reverse-engineered API risk (read this)

There is **no official Ratta developer API**. Both delivery paths use community
reverse-engineered, **non-contractual** endpoints that can change without notice.

**Shared-auth caveat (R-9):** the public and Private Cloud paths **share the same
login flow**. So:

- An **auth-scheme change breaks both targets** — Private Cloud is _not_ a
  fallback for that.
- Private Cloud is a fallback only for **public-endpoint** issues (the public
  host/upload changing), and only for users who **self-host**.
- Non-self-hosters have no fallback (this is the tradeoff of dropping the
  third-party bridge — D-4).

Mitigations in the build: per-path feature flags (each upload path can be
disabled independently), a connect-time health check that recommends switching to
Private Cloud on a public-endpoint failure, and retained-job retry after
reconnect. None of these survive an auth-scheme change.

## Build, test, run

```bash
npm install          # install pinned dependencies
npm run check        # lint + format-check + typecheck + tests with 100% coverage gate
npm run build        # produce a loadable unpacked extension in dist/
npm run package      # build + zip -> artifacts/send-to-supernote.zip
```

Load it in Chrome: `chrome://extensions` → enable **Developer mode** → **Load
unpacked** → select the `dist/` folder.

## Project layout

Domain-Driven Design + ports-and-adapters (hexagonal): pure domain/use-case logic
is fully unit-tested behind ports, and the thin `chrome.*`/`fetch`/DOM adapters
are kept logic-free. The single `fetch` lives in one adapter; all storage is
`chrome.storage.local`.

```
src/
  domain/       # pure values + rules (auth hash, delivery envelopes, job FSM, settings, ...)
  shared/       # ports, Result, md5, filename rules, logger, feature flags
  auth/         # shared login routine, token stores, connect/disconnect, auth-failure handling
  capture/      # Reader / Full Page capture use cases + triggers + copy
  conversion/   # render-document, image inlining, EPUB builder, render routing
  delivery/     # DeliveryPort + public-cloud / private-cloud adapters + resolve-target + fallback
  jobs/         # the send-job saga, queue, retry, health check, history
  settings/     # settings store, folder picker, onboarding copy
  options/ popup/  # UI shells + covered view-models
  background/   # service-worker composition root + thin chrome.* / fetch adapters
  content/ offscreen/  # thin DOM/render shells (Readability, jsPDF, html2canvas, jszip)
docs/
  ddd/architecture.md   # the architecture + FR→module→commit plan
  adr/*.md              # decision records (hexagonal, toolchain, login routine, delivery port, ...)
  PRIVACY.md PERMISSIONS.md SECURITY-REVIEW.md SPIKE-F5-FR1.md
```

## Deferred before public launch

These require real credentials, a real device, or hosting, so they are run by the
user/maintainer — not validated in this repo. The code paths are built and
covered by mocked tests; these are the live confirmation steps:

- **F5-FR1 live integration spike** — pin the working API host + header profile
  and `countryCode`, and confirm `login → apply → PUT → finish` end-to-end from a
  real service worker against a real account. See
  [`docs/SPIKE-F5-FR1.md`](docs/SPIKE-F5-FR1.md).
- **On-device sync confirmation (both targets)** — confirm a sent file arrives and
  opens on a real Supernote: via public Cloud (device signed into the same
  account) and via Private Cloud (device paired to the same self-hosted server).
  EPUB on-device rendering likewise.
- **Live network-destination capture** — a real network trace confirming bytes go
  only to `cloud.supernote.com` (+ Ratta S3) or your own Private Cloud base URL
  (the mocked-network audits pin this invariant in code; this is the live check).
- **Host the Privacy Policy page** at the pinned URL in
  [`docs/PRIVACY.md`](docs/PRIVACY.md) and confirm the final URL before the
  Chrome Web Store listing.

## License

MIT — see [`LICENSE`](LICENSE).
