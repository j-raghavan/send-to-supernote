# Permission Justifications — Firefox (AMO) — Send to Supernote

This complements [`PERMISSIONS.md`](./PERMISSIONS.md) (the Chrome Web Store
justifications). The feature set, hosts, and data flow are identical across
browsers; only the Origin-stripping mechanism may differ. There are **no unused
permissions**, **no `<all_urls>`**, **no `debugger`**, and **no `identity`**.

## Same as Chrome

`activeTab`, `scripting`, `contextMenus`, `storage`, `notifications`, `cookies`,
and the host permissions (`cloud.supernote.com`, `viewer.supernote.com`,
`*.amazonaws.com`) are requested and justified identically to the Chrome build —
see [`PERMISSIONS.md`](./PERMISSIONS.md). On Firefox, DOM-dependent work
(Readability extraction + HTML → EPUB/PDF rendering) runs in-page on the
DOM-capable event page, so the `offscreen` permission is **not** requested.

## Origin-header stripping (the only mechanism difference)

The Supernote upload API host `viewer.supernote.com` returns **HTTP 403 when a
browser `Origin` header is present** (F5-FR1 spike). The extension must remove
that one header on its own API requests so the user's upload succeeds.

- **Default on Firefox:** the same host-scoped declarativeNetRequest rule used on
  Chrome (`public/dnr-rules.json`) carries over via the Firefox manifest. It
  removes header `origin`, scoped to `viewer.supernote.com` +
  `cloud.supernote.com`, for `xmlhttprequest` only.
- **Fallback (`webRequest` + `webRequestBlocking`):** requested **only if** the
  live DNR spike (FF3-FR1) shows DNR is insufficient on Firefox. If used, it is
  justified **exactly as the Chrome DNR rule**:
  - It **only removes the `Origin` header** — it reads, writes, and forwards no
    other header and no request/response body.
  - It is **scoped to `viewer.supernote.com` and `cloud.supernote.com`** for
    `xmlhttprequest` requests only — the same scope as the DNR rule.
  - It **reads no page content** and **contacts no new destination** — no new
    host or origin is introduced beyond the already-declared Supernote hosts.
  - It **never touches the S3 `PUT`** to `*.amazonaws.com` (I-F3); that request
    is outside the listener's URL/type filter, so the uploaded file bytes are
    never inspected or modified.

Either way, the mechanism does one thing: strip the `Origin` header on the
extension's own requests to the Supernote API hosts, keeping the flow
client-side. No file content, page content, or third-party data is read or
shared.
