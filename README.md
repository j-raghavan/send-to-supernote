# Send to Supernote

A Manifest V3 Chrome extension that captures the current web page as a clean,
reflow-friendly **EPUB** (or PDF) **entirely on your device** — or, when the page
is already a PDF, sends it through as-is — and delivers it to your Supernote
(Ratta) tablet via the public Supernote Cloud or your own self-hosted Supernote
Private Cloud. Click the toolbar icon (or right-click → **Send to Supernote**);
the file appears on the tablet after the device runs its next sync (timing is
user/network-dependent, not real-time). Inspired by reMarkable's "Read on
reMarkable", but the conversion happens client-side (Ratta has no conversion
service).

## What it sends

- **Reader (default)** — extracts the article with Mozilla Readability (on a
  _clone_ of the page, never mutating it) and renders a clean, reflow-friendly
  **EPUB** (or a paginated **PDF**). If a page isn't a clean article, it falls
  back to the page body (scripts/styles stripped) so you still get a document
  rather than an empty one.
- **Full Page** — right-click → _Send to Supernote (Full Page)_ captures the page
  **as it looks**: it scrolls top-to-bottom, screenshots each viewport, and
  stitches them into an image-based **PDF** (true visual fidelity, vs Reader's
  reflow). Known limits: fixed/sticky banners are shown **once** (not repeated on
  every screen), very tall pages are **capped** (~50 pages) with a notice, and the
  PDF is a screenshot — its text is **not selectable**. Use Reader when you want
  searchable text.
- **PDF pass-through** — a page that is _already_ a PDF (e.g. an arXiv paper in
  the browser's PDF viewer) is uploaded **as-is**, with no capture or conversion
  (this takes priority — a PDF tab pass-throughs even if you pick Full Page).

The toolbar button sends with your default mode (Reader); the right-click menu
lets you choose **Reader** or **Full Page** per send.

- **Add source & time** (opt-in, off by default) — a popup toggle that stamps the
  page's **original URL** and the **capture time** onto the file: a small visible
  header plus file metadata (PDF document properties; EPUB `dc:source`/`dc:date`).
  Handy for tracking where a saved document came from. It is off by default
  because it embeds your browsing source in the file; the choice is sticky and
  stored locally. See [`docs/PRIVACY.md`](./docs/PRIVACY.md).

## Delivery targets

Both targets are inside the Supernote ecosystem; there is **no third-party
bridge** (no Dropbox/Drive).

- **Supernote Cloud (primary)** — sign in on Supernote's **own** login page
  (it handles the CAPTCHA and any verification code); the extension captures the
  resulting `x-access-token` session cookie and never sees your password. Upload
  is the reverse-engineered `apply → PUT bytes to the pre-signed S3 URL
Supernote's API issues → finish`. Serves all users.
- **Supernote Private Cloud (alternative, self-hosted)** — upload to _your own_
  server at a base URL you configure (e.g. `http://192.168.x.x:19072` on a LAN, or
  an HTTPS reverse-proxy host). The flow differs only in the upload step:
  `apply (with timestamp + nonce headers) → multipart POST of the file to the
upload URL the apply step returns (commonly /api/oss/upload — never hardcoded)
→ finish`. Uses the same login as public Cloud and stores a **JWT only**.

  > **Reachability:** the server must be reachable over plain `http://<ip>:19072`
  > (the stock Docker port — the extension shows an unencrypted-on-LAN warning) **or**
  > HTTPS with a certificate your browser trusts. A browser/extension `fetch` cannot
  > bypass TLS validation, so a **self-signed** certificate will fail until you import
  > it into your OS/browser trust store; alternatively use a CA-trusted cert
  > (e.g. Let's Encrypt via a real domain). Pointing `https://` at the HTTP-only
  > port 19072 will fail the TLS handshake — use `http://…:19072` there.

A send is "done" **only after `finish` reports success**; an applied-but-not-
finished upload is treated as a failure.

## Credentials & data flow

- **Token-only storage (D-2).** Only the access token (the Cloud session token,
  or a JWT for Private Cloud) is persisted, in `chrome.storage.local` (never
  `chrome.storage.sync`). Your **password is never stored or logged**: for
  Supernote Cloud the extension never sees it (you sign in on Supernote's page —
  only the session cookie is read); for Private Cloud it's used in memory only to
  compute the login hash, then discarded. On an expired/invalid token (`401` _or_
  the application-level `E0401` envelope at HTTP 200) you're re-prompted; there is
  no silent re-login.
- **Zero-intermediary, no third party (D-3).** Page content is converted locally
  and uploaded **only** to your chosen target — `cloud.supernote.com` (+ Ratta's
  own S3) or your own Private Cloud server. No server operated by this project is
  in the path, there is **no third-party OAuth** (no `identity` permission), and
  there is no telemetry or analytics.

## Demo Video

https://github.com/user-attachments/assets/fe7610c0-ae3f-4669-a57d-5e9dc79645e8

### Steps Shown in this demo

- Opening the Extension (After installation)
- Connecting to the SuperNote Cloud
- Authenticating with SuperNote Cloud
- Visiting to a Arxiv website to a paper
- Open the paper in the browser (video shows pdf version, even HTML works fine too)
- Opening the extension and clicking `Send to Supernote` which is send the complete PDF document over to your Supernote Cloud
- Once it is on your Supernote Cloud, you can sync that file to your device

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
  auth/         # login routine (Private Cloud), token stores, cookie-capture Cloud connect, disconnect, auth-failure handling
  capture/      # Reader capture use case + context-menu triggers + copy
  conversion/   # render-document, image inlining, EPUB builder, render routing
  delivery/     # DeliveryPort + public-cloud / private-cloud adapters + resolve-target + fallback
  jobs/         # the send-job saga, queue, retry, health check, history
  settings/     # settings store, folder picker, onboarding copy
  options/ popup/  # UI shells + covered view-models
  background/   # service-worker composition root + thin chrome.* / fetch adapters
  content/ offscreen/  # thin DOM/render shells (Readability, jsPDF, jszip)
docs/
  ddd/architecture.md   # the architecture + FR→module→commit plan
  adr/*.md              # decision records (hexagonal, toolchain, login routine, delivery port, ...)
  PRIVACY.md PERMISSIONS.md SECURITY-REVIEW.md SPIKE-F5-FR1.md
```

## License

MIT — see [`LICENSE`](LICENSE).
