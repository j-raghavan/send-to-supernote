# Privacy Policy — Send to Supernote

- **Last updated:** 2026-05-28
- **Intended hosted URL:** `https://j-raghavan.github.io/send-to-supernote/privacy`
  (this exact value is in `src/options/privacy-copy.ts` as `PRIVACY_POLICY_URL`).

> **Deferred deploy step (like the F5-FR1 live spike):** this Markdown is the
> source of truth for the policy text, but a *hosted* page at the URL above must
> be published before the Chrome Web Store listing goes live. Hosting the page
> and confirming the final URL is a deferred-to-user step — see the global DoD.

## What this extension does

Send to Supernote captures the current web page, converts it to a PDF (or EPUB)
**entirely on your device**, and uploads it to **your** Supernote destination —
either the public Supernote Cloud or your own self-hosted Supernote Private
Cloud server.

## What we store, and where

- **A session token only.** When you connect, the extension stores the derived
  access token (a JWT for Private Cloud) in `chrome.storage.local` **on this
  device only**. Your **password is never stored** — it is used in memory only to
  compute the login hash during sign-in and is then discarded (D-2).
- **No `chrome.storage.sync`.** Nothing sensitive is synced across machines.
- **Local settings** (default capture mode/format, target, destination folder,
  filename-confirm toggle) and a short local **send history** are stored locally
  for your convenience. None of it leaves your device except as part of a send
  you initiate.

## Where your data goes

- **Page content is converted locally** in the extension (no server-side
  rendering) and is uploaded **only** to the destination you choose:
  - **Supernote Cloud** — `cloud.supernote.com` (or `viewer.supernote.com`) and
    Ratta's own storage backend (Amazon S3), reached via a pre-signed URL that
    Supernote's own API issues; **or**
  - **Your Private Cloud server** — the exact base URL you configured; nothing
    leaves your network beyond your own server.
- **No third-party providers.** There is no Dropbox/Google Drive/OneDrive bridge.
- **No server operated by this project.** The extension is the only intermediary
  and runs locally; we never receive your page content or credentials (D-3).
- **No third-party OAuth.** The extension requests no `identity` permission and
  shares data with no third party (F10-FR6).
- **No telemetry, no analytics, no remote logging.**

## Permissions

Each permission is justified, one-to-one with a feature it requires, in
[`docs/PERMISSIONS.md`](./PERMISSIONS.md). The extension requests no `debugger`,
no `identity`, and no `<all_urls>` host access.

## Your control

- **Disconnect** at any time to remove the stored token (and account/equipment)
  from this device.
- Uninstalling the extension removes all locally stored data.

## Security review

The credential lifecycle, the zero-intermediary data flow with network-audit
evidence, and the HTTP-over-LAN consideration for Private Cloud are documented in
[`docs/SECURITY-REVIEW.md`](./SECURITY-REVIEW.md).

## Contact

File issues at the project repository.
