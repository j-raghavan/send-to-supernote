# Permission Justifications — Send to Supernote

Every requested permission maps one-to-one to a feature that requires it. There
are **no unused permissions**. The extension requests **no `debugger`**, **no
`identity`**, and **no `<all_urls>`** host access.

## Permissions

| Permission | Why it is needed | Feature |
|---|---|---|
| `activeTab` | Read the active tab (URL/title) and inject the capture script on the user's click — instead of broad host access. | F3/F4 capture, F6 send |
| `scripting` | Inject the Reader/Full-Page extractor into the active tab via `chrome.scripting.executeScript`. | F3-FR1, F4-FR2 |
| `contextMenus` | Add the right-click "Send to Supernote (Reader View)" / "(Full Page)" items. | F6-FR2 |
| `storage` | Persist the session token, settings, destination folder, and local send history in `chrome.storage.local` (never `.sync`). | F2, F7, F9, Data Model |
| `notifications` | Show progress (capturing → uploading → done), the success "sync your device" toast, and actionable failures (incl. the Private Cloud fallback offer). | F6-FR5, F9-FR2 |
| `offscreen` | Run DOM-dependent rendering (HTML → PDF/EPUB / `html2canvas`) in an offscreen document, since the MV3 service worker has no DOM. | F1-FR5, F3, F4 |
| `cookies` | Read the `x-access-token` session cookie that `cloud.supernote.com` sets **after the user signs in on Supernote's own page** — public Cloud login is CAPTCHA/2FA-gated, so the extension never logs in itself. Scoped by host_permissions to the Supernote hosts; the token is stored locally only and goes only to the Supernote API (D-3). | F2 (Cloud connect) |
| `declarativeNetRequestWithHostAccess` | Strip the browser `Origin` header on requests to the Supernote API hosts only — the F5-FR1 spike found `viewer.supernote.com` returns HTTP 403 when an `Origin` header is present. Host-scoped (uses host_permissions), not the broad `declarativeNetRequest`. Keeps the flow client-side (D-3). | F5-FR1 (spike), F5 |

**Intentionally NOT requested:**

- **`debugger`** — high-fidelity print-to-PDF is out of MVP scope (Web Store
  review risk). (D-1 / Constraints)
- **`identity`** — there is no third-party OAuth and no third-party data sharing
  (D-4 / F10-FR6).
- **broad `declarativeNetRequest`** — not requested; only the host-scoped
  `declarativeNetRequestWithHostAccess` variant is used (see the table above),
  and it only removes the `Origin` header on the Supernote API hosts.
- **`tabs`** — not requested; `chrome.tabs.query`/`create` work under `activeTab`.

## Host permissions (static)

| Host pattern | Why it is needed | Feature |
|---|---|---|
| `https://cloud.supernote.com/*` | Public Supernote Cloud API (login / apply / list / finish). | F2, F5 |
| `https://viewer.supernote.com/*` | The alternate public-API host; the F5-FR1 spike pins which one the account uses, so both are declared statically. | F5-FR1 (R-8) |
| `https://*.amazonaws.com/*` | `PUT` the file bytes to the pre-signed S3 URL that Supernote's API issues (Ratta's own storage). Narrowed as far as the spike allows. | F5-FR2 |

No `<all_urls>` host permission is requested.

## Optional host permissions (runtime-granted)

| Pattern | Why it is needed | Feature |
|---|---|---|
| `http://*/*`, `https://*/*` | The Private Cloud server's base URL is **user-configured at runtime** (e.g. `http://192.168.x.x:8080` on a LAN, or an HTTPS reverse-proxy host), so it cannot be a static host permission. Access for the **specific entered origin** is requested via `chrome.permissions.request` only when the user saves their Private Cloud URL — not granted up front. | F8-FR1 |

The broad `http(s)://*/*` patterns are listed under `optional_host_permissions`
so Chrome can grant access to exactly the one origin the user types; the
extension never holds broad host access without that explicit grant.
