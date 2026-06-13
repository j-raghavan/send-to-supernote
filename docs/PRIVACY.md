# Privacy Policy — Send to Supernote

- **Last updated:** 2026-06-13
- **Public policy URL:** https://github.com/j-raghavan/send-to-supernote/blob/master/docs/PRIVACY.md
  (this exact value is in `src/options/privacy-copy.ts` as `PRIVACY_POLICY_URL`).

> This Markdown, rendered on GitHub, is the public Privacy Policy for the Chrome
> Web Store listing. It requires this file to be on the default branch (`master`)
> — merge the feature branch before submitting. The in-extension
> `src/privacy/privacy.html` mirrors this text for offline viewing.

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
  filename-confirm toggle, and the **Add source & time** toggle) and a short
  local **send history** are stored locally for your convenience. None of it
  leaves your device except as part of a send you initiate.

## Source URL & capture time (opt-in, off by default)

The popup has an **Add source & time** toggle that is **off by default**. When you
turn it on, each send stamps the page's **original URL** and the **capture time**
into the file you upload — both as a small visible header and as file metadata
(PDF document properties; EPUB `dc:source`/`dc:date`). This is convenient for
tracking where a saved document came from, but it embeds your browsing source in
the file, so it is **opt-in per send**. The preference is stored locally only; the
URL is the page's own address and goes only to the Supernote destination you
choose, never to any third party.

> **Note on URLs with query strings.** The **full** page URL is embedded verbatim
> when this is on — including any query parameters, which can sometimes carry
> session tokens or one-time links. Leave the toggle off (the default) for such
> pages, or remove sensitive query parameters before sending.

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
