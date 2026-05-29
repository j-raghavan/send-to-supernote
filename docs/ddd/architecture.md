# Send to Supernote — DDD Architecture & Implementation Plan

- **Status:** Proposed (v0.1 MVP)
- **Source of truth:** `spec/SPEC-SEND-TO-SUPERNOTE.md` (F1–F10, Interfaces, Data Model, Invariants, Risks)
- **Author:** Architect agent
- **Methodology:** Domain-Driven Design + Ports & Adapters (hexagonal), SOLID / DRY / KISS, reuse-first
- **Last updated:** 2026-05-27

> This document is the engineer's blueprint. It maps **every** FR in F1–F10 to a concrete
> module/file, defines the bounded contexts and the port/adapter seams that keep `chrome.*`
> and `fetch` out of the domain, fixes the tech stack at confirmed versions, gives an
> ordered FR→commit plan, and states the ≥97% coverage strategy. Keep it pragmatic: this is
> a single-developer Chrome extension, not a microservice fleet. Do **not** over-engineer.

> **MVP deviations (2026-05-28) — authoritative over the F4 rows + file-tree entries below.**
> Full Page capture was **removed**: `content/fullpage.ts`, `offscreen/canvas-raster.ts`,
> `domain/fullpage-layout.ts`, and `capture/capture-fullpage.ts` no longer exist; capture is
> Reader-only (`CaptureMode = 'reader'`) with a page-body fallback in the offscreen. Public
> Supernote Cloud connect is **cookie-capture** of the official login (`auth/cloud-session.ts`
> + the `cookies` permission), not extension-side email/password. Reader extraction now runs
> Readability in the **offscreen document** (`background/offscreen-reader.ts`), since an
> `executeScript` `func` cannot reference bundled imports. PDF pages pass through as-is. See
> the spec's "Implementation deviations (MVP)" section.

---

## 1. Architectural drivers (from the spec)

These invariants and constraints shape every decision below. They are non-negotiable.

| ID | Driver | Architectural consequence |
|----|--------|---------------------------|
| I-1 / D-2 | Password never persisted/logged; token-only | Password is a function-local in `auth` use case; never crosses into a port or storage adapter. |
| I-2 / D-3 | Zero-intermediary: bytes go only to public Cloud (+Ratta S3) or the user's own Private Cloud | One `DeliveryPort`; only two adapters; no telemetry/analytics code anywhere. |
| I-3 | A job is "done" only after `finish` returns `success` | Job state machine has an explicit `finishing` step; `done` is unreachable without a verified finish. |
| I-4 | Capture never mutates the live page | Reader/Full-page run on a **clone**; the content-script adapter is the only DOM-touching code. |
| I-5 | Secrets in `chrome.storage.local`, never `.sync` | Storage adapter hardcodes `chrome.storage.local`; a lint/test guard forbids `.sync` for secrets. |
| I-6 | Each upload path independently disableable (feature flag) | `delivery` exposes per-target flags read from settings; resolver respects them. |
| Reverse-engineered API (R-1/R-8/R-9) | Endpoints/hosts/fields breakable; **network must be mockable** | All HTTP behind an `HttpClient` port; host/header profile is data (`supernote.apiHost`), not code. |
| MV3 (Constraints) | No DOM in the service worker; offscreen for rendering | `conversion` runs in the offscreen document behind a `RendererPort`; SW orchestrates. |
| F1-FR6 | Multi-MB blobs can't cross `sendMessage` as JSON | Binary handoff port (`BlobTransferPort`) — IndexedDB handle (chosen, see ADR-0006). |

---

## 2. Layered (hexagonal) model

Three rings. Dependencies point **inward only** (Dependency Inversion). The domain knows
nothing about Chrome or `fetch`.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ADAPTERS (impure, thin, mostly untested-by-unit / excluded or smoke)      │
│  ─ chrome.* adapters: storage, runtime msg, offscreen, contextMenus,       │
│    action/badge, notifications, permissions, scripting                     │
│  ─ network adapter: FetchHttpClient (implements HttpClient port)           │
│  ─ DOM adapters (content scripts): ReadabilityExtractor, FullPageSerializer│
│  ─ renderer adapters (offscreen): PdfRenderer, EpubRenderer, CanvasRaster  │
│  ─ UI shells: options page, popup page (DOM event wiring only)             │
└───────────────▲────────────────────────────────────────────────────────────┘
                │ implements ports (interfaces)
┌───────────────┴────────────────────────────────────────────────────────────┐
│  APPLICATION (use cases / orchestration — PURE TS, fully unit-tested)        │
│  ─ auth: ConnectAccount, Disconnect, EnsureValidToken, HandleAuthFailure     │
│  ─ capture: CaptureReader, CaptureFullPage (call ExtractorPort)              │
│  ─ conversion: RenderDocument (calls RendererPort)                           │
│  ─ delivery: DeliverDocument (resolves target → DeliveryPort), Fallback     │
│  ─ jobs: SendDocument (the saga), JobQueue, RetryPending, PruneStale         │
│  ─ settings: GetSettings, SaveSettings, ListFolders, PickFolder             │
│  ─ ports: HttpClient, KeyValueStore, Notifier, Badge, Renderer, Extractor,  │
│           BlobTransfer, PermissionGranter, Clock, RandomSource, Logger       │
└───────────────▲────────────────────────────────────────────────────────────┘
                │ uses domain types
┌───────────────┴────────────────────────────────────────────────────────────┐
│  DOMAIN (pure values + rules — 100% unit-tested, zero I/O, zero chrome/fetch)│
│  ─ auth: loginHash(), CountryCode, Credential (transient), Token, AuthError  │
│  ─ delivery: SupernoteApiProfile, ApplyResult, FinishResult, ResponseEnvelope│
│  ─ jobs: SendJob (entity), JobState (FSM), JobPolicy (TTL/cap/retry)         │
│  ─ files: sanitizeFilename(), dedupeName(), fallbackName(), md5hex(), Folder │
│  ─ settings: Settings (value object), Target, CaptureMode, OutputFormat      │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Rule of thumb for the engineer:** if a function calls `chrome.*` or `fetch`, it lives in an
adapter and is kept *thin* (no branching logic worth testing). Everything decision-bearing
lives in domain/application and is unit-tested against fakes.

---

## 3. Bounded contexts (domains)

Seven contexts under `src/`. Each owns its domain + use cases; cross-context calls go through
ports or published types, never by reaching into another context's internals.

| Context | Responsibility | Spec features |
|---------|----------------|---------------|
| **auth** | Shared login routine, token lifecycle, `401`/`E0401` handling for both targets | F2 (and reused by F8) |
| **capture** | Reader View extraction + Full Page serialization on a DOM clone | F3, F4 |
| **conversion** | Offscreen render of captured HTML → PDF/EPUB blob | F3, F4 (offscreen side) |
| **delivery** | `DeliveryPort` + two adapters (publicCloud, privateCloud) + folder listing + fallback | F5, F8 |
| **jobs** | Send-job saga, queue, persistence, retry, TTL, per-path feature flags, health check | F9 (+ orchestrates F2/F5/F8) |
| **settings** | Typed storage model, defaults, folder picker logic, onboarding copy | F7 (+ Data Model) |
| **ui** | Options + popup shells, badge/notification wiring, one-click send UX | F6, F7 |
| **shared** | Cross-cutting: filename rules, md5, ports, result types, privacy/permissions docs | F1, F6, F10 |

> `delivery` is deliberately one context with two adapters behind a single port: public Cloud
> and Private Cloud differ only in the upload step (S3 `PUT` vs multipart `POST` to an
> apply-returned URL) and envelope shape. Sharing the port lets `jobs` fall back from one to
> the other with the *same already-converted blob* (F8-FR4 / F9-FR2) trivially.

---

## 4. Directory layout (target)

Files stay **< 500 lines** (CLAUDE.md). Tests mirror source under `tests/`. Nothing source/test
lives at root except tooling config.

```
manifest.config.ts            # manifest as TS (typed), consumed by the vite web-ext plugin (F1)
vite.config.ts                # build config (F1)
vitest.config.ts              # test + coverage thresholds (≥97%) (F1)
tsconfig.json                 # strict TS (F1)
eslint.config.js              # flat config, typescript-eslint + prettier (F1)
.prettierrc.json
package.json

src/
  shared/
    result.ts                 # Result<T,E> / typed errors (no exceptions across boundaries)
    ports.ts                  # all port interfaces (HttpClient, KeyValueStore, Notifier, …)
    md5.ts                    # md5hex(bytes) — pure (F5/F8 need hex md5)
    filename.ts               # sanitizeFilename, fallbackName, dedupeName (F6-FR3)
    logger.ts                 # Logger port + a no-PII console adapter (never logs secrets)
    feature-flags.ts          # per-path flags (F9-FR4) read from settings
  domain/
    auth.ts                   # loginHash(sha256(md5(pwd)+code)), Token, CountryCode, AuthError
    delivery.ts               # ApiProfile, ResponseEnvelope normalizer, Apply/Finish results, isAuthFailure
    job.ts                    # SendJob entity + JobState FSM + transitions (I-3)
    job-policy.ts             # cap, TTL, retry eligibility (F9)
    settings.ts               # Settings value object, Target, CaptureMode, OutputFormat, defaults
    folder.ts                 # Folder model + isFolder normalization (bool vs "Y"/"N") (F7/F8)
  auth/
    connect-account.ts        # ConnectAccount use case (F2-FR1/FR2/FR3), uses shared login
    login-routine.ts          # shared nonce→hash→login (F2-FR0), param: baseUrl+profile
    token-store.ts            # EnsureValidToken, persist/clear via KeyValueStore (F2)
    handle-auth-failure.ts    # clear token, set expired, notify, open options, retain job (F2-FR4)
    disconnect.ts             # Disconnect (F2-FR5)
  capture/
    capture-reader.ts         # CaptureReader use case → ExtractorPort (F3)
    capture-fullpage.ts       # CaptureFullPage use case → ExtractorPort (F4)
  conversion/
    render-document.ts        # RenderDocument use case → RendererPort (F3-FR2/FR3, F4-FR2)
  delivery/
    delivery-port.ts          # DeliveryPort: apply/upload/finish + listFolders + healthCheck
    public-cloud-adapter.ts   # apply→S3 PUT→finish, list/query, envelope=boolean (F5)
    private-cloud-adapter.ts  # apply(+nonce/ts)→multipart POST<applyUrl>→finish, "Y"/"N" (F8)
    resolve-target.ts         # pick adapter by settings.target + feature flags (F9-FR4)
    fallback.ts               # public→private offer, reuse converted blob (F8-FR4/F9-FR2)
  jobs/
    send-document.ts          # the saga: ensure token→capture→render→deliver→finish (F6/F5/F8)
    job-queue.ts              # JobQueue: enqueue, dequeue, persist via KeyValueStore (F9-FR1/FR5)
    retry-pending.ts          # retry retained jobs after reconnect (F9-FR1)
    prune-stale.ts            # TTL prune (F9-FR5)
    health-check.ts           # cheap authed call per target on connect (F9-FR3)
  settings/
    settings-store.ts         # typed get/save over KeyValueStore (Data Model, F7-FR1/FR4)
    list-folders.ts           # ListFolders use case via DeliveryPort, paginates (F5-FR3/F7-FR2)
    onboarding.ts             # sync-expectation + target-match copy (F7-FR6)
  background/                 # ADAPTERS (service worker entry + chrome wiring)
    service-worker.ts         # entry: composition root, registers menus/action/listeners (F1)
    chrome-storage.ts         # KeyValueStore impl over chrome.storage.local only (I-5)
    fetch-http-client.ts      # HttpClient impl over fetch (the ONLY fetch in the codebase)
    offscreen-manager.ts      # single-instance create/close w/ reasons (F1-FR5), RendererPort proxy
    blob-transfer.ts          # BlobTransfer impl: IndexedDB handle handoff (F1-FR6, ADR-0006)
    notifications.ts          # Notifier impl over chrome.notifications (F6-FR5)
    badge.ts                  # Badge impl over chrome.action (F6-FR5/F2-FR6)
    context-menus.ts          # context menu registration → send-document (F6-FR2)
    permissions.ts            # PermissionGranter impl over chrome.permissions (F8-FR1)
    scripting.ts              # inject content scripts via chrome.scripting (F3/F4)
  content/
    reader.ts                 # ExtractorPort impl: Readability on a document CLONE (F3-FR1, I-4)
    fullpage.ts               # ExtractorPort impl: serialize rendered DOM+styles (F4-FR2/FR3)
  offscreen/
    offscreen.html
    offscreen.ts              # RendererPort impl host: routes to pdf/epub/raster
    pdf-renderer.ts           # html→PDF via jspdf (F3-FR2, F4-FR2)
    epub-renderer.ts          # html→EPUB via jszip (F3-FR3) [gated by R-6 decision]
    canvas-raster.ts          # html2canvas rasterize for full page (F4-FR2/FR4)
  options/
    options.html
    options.ts                # Options shell: connection, defaults, folder picker, priv cloud (F7)
  popup/
    popup.html
    popup.ts                  # Popup shell: state, one-off send, job history (F6-FR6)

tests/
  unit/**                     # mirrors src/domain, src/<context> use cases (pure, fakes)
  integration/**              # mocked-network end-to-end sagas (F5/F8 flows)
  fakes/                      # FakeHttpClient, FakeKeyValueStore, FakeRenderer, FakeExtractor…
  fixtures/                   # sample articles, API response envelopes, test vectors

docs/
  ddd/architecture.md         # this file
  adr/*.md                    # MADR decision records
  PRIVACY.md                  # F10-FR1
  PERMISSIONS.md              # F10-FR2
  SECURITY-REVIEW.md          # F10-FR5
```

---

## 5. Ports (the testability seam)

All in `src/shared/ports.ts` (domain-owned interfaces; adapters in `src/background`, `src/content`,
`src/offscreen`). This is what makes ≥97% coverage achievable: the domain depends on these, tests
inject fakes, and the real `chrome.*`/`fetch` adapters stay thin.

| Port | Methods (shape) | Real adapter | Fake (tests) |
|------|-----------------|--------------|--------------|
| `HttpClient` | `request(req): Promise<HttpResponse>` (url, method, headers, body) | `fetch-http-client.ts` | `FakeHttpClient` (scripted responses, records calls/destinations) |
| `KeyValueStore` | `get/set/remove/keys` (namespaced) | `chrome-storage.ts` (local only) | in-memory map |
| `Notifier` | `notify(level, title, msg, action?)` | `notifications.ts` | recorder |
| `Badge` | `set(state)` (`idle/busy/error/expired`) | `badge.ts` | recorder |
| `Renderer` | `render(html, format, opts): Promise<BlobHandle>` | offscreen `offscreen.ts` (via manager) | returns canned handle |
| `Extractor` | `extractReader()/serializeFullPage()` | content `reader.ts`/`fullpage.ts` | canned HTML |
| `BlobTransfer` | `put(bytes): handle`, `get(handle): bytes`, `delete(handle)` | `blob-transfer.ts` (IndexedDB) | in-memory |
| `PermissionGranter` | `request(origin): Promise<boolean>` | `permissions.ts` | always-grant / deny toggle |
| `Clock` | `now(): number` | wraps `Date.now` | fixed time (TTL/dedupe tests) |
| `RandomSource` | `digits(n)`, `uuid()` | `crypto` | deterministic (nonce/equipment tests) |
| `Logger` | `info/warn/error` (PII-scrubbed) | console adapter | recorder (assert no secrets) |

Crypto note: `loginHash` uses `md5` (hex, pre-image) + `sha256` (WebCrypto `crypto.subtle.digest`).
md5 is not in WebCrypto, so a small bundled md5 (`src/shared/md5.ts`, pure) is used; sha256 goes
through WebCrypto in an adapter wrapper so the domain stays pure-testable (the hash *composition*
is domain logic; the digest primitive is injected).

---

## 6. FR → module → test mapping (complete, all of F1–F10)

Every FR has a home. "Kind": **code** = pure code + mocked tests; **spike** = needs live
credentials/device, engineer ships the code path + MOCKED tests and live validation is **deferred**
(user runs it, documented in README/SECURITY-REVIEW).

### F1 — Scaffold & MV3 manifest
| FR | Module(s) | Kind |
|----|-----------|------|
| F1-FR1 | `manifest.config.ts` | code |
| F1-FR2 | `manifest.config.ts` (permission set) | code |
| F1-FR3 | `manifest.config.ts` (static both hosts + S3; private via optional+runtime) | code |
| F1-FR4 | `vite.config.ts`, `package.json` build/zip scripts | code |
| F1-FR5 | `background/offscreen-manager.ts`, `offscreen/offscreen.html` | code (lifecycle unit-tested via fakes; manual load = deferred) |
| F1-FR6 | `background/blob-transfer.ts` (IndexedDB handle), ADR-0006 | code |

### F2 — Account connection & token-only auth
| FR | Module(s) | Kind |
|----|-----------|------|
| F2-FR0 | `auth/login-routine.ts` (param baseUrl+profile, returns token) | code |
| F2-FR1 | `auth/connect-account.ts`, `options/options.ts` | code |
| F2-FR2 | `auth/login-routine.ts` (password local only; cleared) | code |
| F2-FR3 | `domain/auth.ts` `loginHash` + test vector | code |
| F2-FR4 | `auth/handle-auth-failure.ts`, `domain/delivery.ts` `isAuthFailure` (401 + E0401) | code |
| F2-FR5 | `auth/disconnect.ts` | code |
| F2-FR6 | `background/badge.ts`, `popup/popup.ts` | code (state unit-tested; visual = deferred) |

### F3 — Reader View capture
| FR | Module(s) | Kind |
|----|-----------|------|
| F3-FR1 | `content/reader.ts` (clone), `capture/capture-reader.ts` | code |
| F3-FR2 | `offscreen/pdf-renderer.ts`, `conversion/render-document.ts` | code |
| F3-FR3 | `offscreen/epub-renderer.ts` (gated by R-6) | code |
| F3-FR4 | `offscreen/pdf-renderer.ts` (image fetch/skip) | code |
| F3-FR5 | `capture/capture-reader.ts` (empty→"try Full Page") | code |
| F3-FR6 | `shared/filename.ts` | code |

### F4 — Full Page capture
| FR | Module(s) | Kind |
|----|-----------|------|
| F4-FR1 | `background/context-menus.ts`, `popup/popup.ts` | code |
| F4-FR2 | `content/fullpage.ts`, `offscreen/canvas-raster.ts`, `offscreen/pdf-renderer.ts` | code |
| F4-FR3 | `content/fullpage.ts` (scroll-trigger), `offscreen/canvas-raster.ts` (tile/stitch) | code (logic unit-tested; visual fidelity = deferred) |
| F4-FR4 | `offscreen/canvas-raster.ts` (taint handling) | code |
| F4-FR5 | `popup/popup.ts`, `options/options.ts` (label copy) | code |

### F5 — Public Cloud upload pipeline
| FR | Module(s) | Kind |
|----|-----------|------|
| **F5-FR1** | spike doc + `domain/delivery.ts` `ApiProfile` (host/header data) | **spike** (live; code path = configurable profile + mocked tests) |
| F5-FR2 | `delivery/public-cloud-adapter.ts` (apply→PUT→finish), `shared/md5.ts` | code |
| F5-FR3 | `settings/list-folders.ts`, `delivery/public-cloud-adapter.ts` | code |
| F5-FR4 | `delivery/public-cloud-adapter.ts` + `domain/delivery.ts` envelope/`isAuthFailure` | code |
| F5-FR5 | integration test asserting destinations (D-3) | code |
| F5-FR6 | `domain/job.ts` FSM (done only after finish success, I-3) | code |

### F6 — One-click send UX
| FR | Module(s) | Kind |
|----|-----------|------|
| F6-FR1 | `background/service-worker.ts` action handler → `jobs/send-document.ts` | code |
| F6-FR2 | `background/context-menus.ts` | code |
| F6-FR3 | `shared/filename.ts` (sanitize/fallback/dedupe — heavy unit tests) | code |
| F6-FR4 | `popup/popup.ts` / send-document confirm hook | code |
| F6-FR5 | `background/notifications.ts`, `background/badge.ts` | code |
| F6-FR6 | `popup/popup.ts` (+ job history from `jobs/job-queue.ts`) | code |

### F7 — Options / settings
| FR | Module(s) | Kind |
|----|-----------|------|
| F7-FR1 | `settings/settings-store.ts`, `options/options.ts` | code |
| F7-FR2 | `settings/list-folders.ts`, `domain/folder.ts` (normalize), `options/options.ts` | code |
| F7-FR3 | `options/options.ts` (private cloud section + HTTP warning) | code |
| F7-FR4 | `settings/settings-store.ts` (no-reload reads) | code |
| F7-FR5 | `options/options.ts` (privacy link + "password never stored") | code |
| F7-FR6 | `settings/onboarding.ts` + `options/options.ts` copy | code |

### F8 — Private Cloud target
| FR | Module(s) | Kind |
|----|-----------|------|
| F8-FR1 | `background/permissions.ts`, `auth/login-routine.ts` (reused), `domain/settings.ts` baseUrl validation | code (live connect = deferred) |
| F8-FR2 | `delivery/private-cloud-adapter.ts` (apply+nonce/ts → multipart POST<applyUrl> → finish) | code |
| F8-FR3 | `settings/list-folders.ts`, `domain/folder.ts` ("Y"/"N") | code |
| F8-FR4 | `delivery/fallback.ts`, `delivery/resolve-target.ts` | code |
| F8-FR5 | `auth/disconnect.ts` (private variant) | code |
| F8-FR6 | `domain/delivery.ts` (auth vs connection-error classification) | code |
| F8-FR7 | `options/options.ts` + `settings/onboarding.ts` (non-HTTPS warning) | code |

### F9 — Resilience, retention, health
| FR | Module(s) | Kind |
|----|-----------|------|
| F9-FR1 | `jobs/job-queue.ts`, `jobs/retry-pending.ts` | code |
| F9-FR2 | `delivery/fallback.ts`, `jobs/send-document.ts` | code |
| F9-FR3 | `jobs/health-check.ts` | code |
| F9-FR4 | `shared/feature-flags.ts`, `delivery/resolve-target.ts` | code |
| F9-FR5 | `jobs/job-queue.ts` (persist), `jobs/prune-stale.ts` (TTL), `domain/job-policy.ts` | code |

### F10 — Privacy, security, Web Store
| FR | Module(s) | Kind |
|----|-----------|------|
| F10-FR1 | `docs/PRIVACY.md` | code (doc) |
| F10-FR2 | `docs/PERMISSIONS.md` | code (doc) |
| F10-FR3 | guard test: no secret to `chrome.storage.sync` (I-5) | code |
| F10-FR4 | build assertion / test: no runtime CDN/remote script (deps bundled) | code |
| F10-FR5 | `docs/SECURITY-REVIEW.md` (+ attach F5-AC5/F8-AC5 audits) | code (doc; live audits deferred) |
| F10-FR6 | `manifest.config.ts` (no `identity`), `docs/PRIVACY.md` | code |

**Deferred-to-user (live) validation items** (engineer ships code + mocked tests; user runs live):
F5-FR1 host/header/countryCode spike; all on-device sync confirmations (F3/F4/F5/F8 DoDs);
real-account connect for both targets; F5-AC5 / F8-AC5 live network-destination audits.

---

## 7. The send-job saga (jobs/send-document.ts)

The orchestration that ties the contexts together. Pure use case; all I/O via ports. State machine
in `domain/job.ts` guarantees I-3.

```
queued
  → ensureValidToken(target)            [auth] — no token → notify "connect first", abort
  → capturing                           [capture] → {title, html}  (clone, I-4)
        empty extraction (reader)       → fail "try Full Page" (F3-FR5)
  → converting                          [conversion via Renderer] → BlobHandle (F1-FR6)
        render fail (retry once)        → fail actionable (Edge Cases) 
  → computing md5+size                  [shared/md5]
  → name = sanitize(title) | fallback   [shared/filename] ; dedupe vs listFolders (F6-FR3)
  → uploading (resolveTarget)           [delivery] apply → upload → 
        authFailure (401/E0401)         → handleAuthFailure, RETAIN job (F2-FR4/F9-FR1)
        non-auth public failure         → offer Private Cloud fallback w/ SAME blob (F9-FR2)
  → finishing                           [delivery] finish → success?  (I-3)
        finish !success                 → fail, do NOT mark done (F5-AC6)
  → done                                → notify "Sent — sync your device"
```

Persisted at each transition (F9-FR5) so a service-worker eviction resumes from the last completed
step (re-capture only if pre-conversion — Edge Cases).

---

## 8. Tech stack (versions confirmed on npm, 2026-05-27)

| Concern | Choice | Version | Why |
|---------|--------|---------|-----|
| Language | TypeScript (`strict`) | `6.0.3` | Spec mandate; strict catches boundary bugs |
| Bundler | Vite | `8.0.14` | Fast, ESM-native; MV3 entry handling via plugin |
| MV3 plugin | `@samrum/vite-plugin-web-extension` | `5.1.1` | Typed `manifest.config.ts`, multi-entry (SW/content/offscreen/options/popup), HMR for dev |
| Test runner | Vitest | `4.1.7` | Vite-native, fast, first-class TS/ESM |
| Coverage | `@vitest/coverage-v8` | `4.1.7` | v8 provider; threshold gate ≥97% |
| Lint | ESLint (flat) + `typescript-eslint` | `10.4.0` / `8.60.0` | Type-aware rules |
| Format | Prettier + `eslint-config-prettier` | `3.8.3` / `10.1.8` | Zero format errors gate |
| Chrome mock | `sinon-chrome` (+ hand-rolled fakes) | `3.0.1` | Mock `chrome.*` globals in tests; prefer our own port-fakes for domain |
| Chrome types | `@types/chrome` | `0.1.42` | Typed `chrome.*` in adapters |
| Article extract | `@mozilla/readability` | `0.6.0` | F3 Reader View (spec-named) |
| PDF | `jspdf` | `4.2.1` | F3/F4 PDF render (spec-named) |
| Rasterize | `html2canvas` | `1.4.1` | F4 Full Page (spec-named) |
| EPUB | `jszip` | `3.10.1` | F3-FR3 EPUB container (gated by R-6; deps bundled) |
| Hashing | bundled `md5.ts` + WebCrypto `sha256` | n/a | Login hash; md5 not in WebCrypto |

Decision: **bundler = Vite + `@samrum/vite-plugin-web-extension`** over raw esbuild — it handles the
MV3 multi-entry graph (service worker, content scripts, offscreen, options, popup) and emits a
loadable manifest from `manifest.config.ts`, which is exactly F1's shape. Pairs natively with Vitest
so one toolchain covers build + test (KISS). See ADR-0002.

EPUB (R-6): default **PDF-only MVP**; EPUB code path (`epub-renderer.ts`) is built behind
`settings.defaultFormat === "epub"` and unit-tested, but on-device EPUB validation is deferred. If
the stakeholder defers EPUB entirely, F3-FR3 ships disabled behind the format flag (still tested).

---

## 9. Coverage strategy (≥97% line/branch, source-only)

1. **Thin adapters, fat domain.** All branching/decision logic lives in `domain/` + `<context>/`
   use cases, tested against fakes → near-100% there. Adapters (`background/*.ts`, `content/*.ts`,
   `offscreen/*.ts`) are kept to mechanical `chrome.*`/`fetch`/DOM calls with no untested branches.
2. **Coverage config** (`vitest.config.ts`): provider `v8`; `thresholds: { lines: 97, branches: 97,
   functions: 97, statements: 97 }`; `include: ['src/**']`.
3. **Sensible excludes** (not gaming the metric — these are un-unit-testable glue / generated):
   - `*.html`, `manifest.config.ts`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`
   - `**/*.d.ts`, type-only files (`src/domain/*types*` if any), barrel `index.ts` re-exports
   - entry shells whose logic is fully delegated: `src/background/service-worker.ts` registration
     wiring, `src/offscreen/offscreen.html` host bootstrap, `options.html`/`popup.html`
   - the real adapter classes are *smoke-tested* with `sinon-chrome`, but if a thin adapter has no
     logic, it may be excluded with an inline justification comment citing this section.
   - **Never excluded:** `domain/**`, every use case in `auth/ capture/ conversion/ delivery/ jobs/
     settings/`, `shared/filename.ts`, `shared/md5.ts`, `shared/feature-flags.ts`.
4. **High-value test targets** (per Required Tests): filename rules (many cases), `loginHash`
   vector, public/private upload ordering + envelope normalization, job FSM transitions, retry +
   fallback (same blob), no-secret-to-`.sync` guard.
5. **Per-commit gate** (CLAUDE.md): each FR commit only when `0 lint, 0 format, 0 type, tests pass,
   coverage ≥97%`. Run `npm run check` (lint + format-check + typecheck + `vitest run --coverage`).

---

## 10. Ordered FR → commit plan (one commit per FR)

Dependency-ordered. Each line = exactly one engineer commit, gated by the criteria above.
Format: `Fx-FRn: short imperative`. (Spike FRs commit the **configurable code path + mocked tests**;
live validation deferred.)

**Phase 0 — Foundation (F1)**
1. `F1-FR1` manifest base (MV3, SW module, action, options)
2. `F1-FR2` permission set (no debugger/identity/all_urls)
3. `F1-FR3` host permissions (both public hosts + S3; private via optional/runtime)
4. `F1-FR4` build pipeline → loadable + zipped artifact; tsc/eslint clean
5. `F1-FR5` offscreen manager (single-instance create/close, reasons)
6. `F1-FR6` binary blob handoff (IndexedDB handle)  — *ADR-0006*

**Phase 1 — Domain primitives & auth (F2, shared)**
7. `F6-FR3` filename rules (sanitize/fallback/dedupe) — pulled early; many features depend on it
8. `F2-FR3` `loginHash` (sha256(md5(pwd)+code)) + vector test
9. `F2-FR0` shared login routine (param baseUrl+profile)
10. `F2-FR2` transient password handling (never stored/logged)
11. `F2-FR1` ConnectAccount (public) + token persist
12. `F2-FR4` auth-failure handling (401 + E0401) + isAuthFailure
13. `F2-FR5` Disconnect (clear keys + pending)
14. `F2-FR6` connection-state badge/popup reflection

**Phase 2 — Capture & conversion (F3, F4)**
15. `F3-FR1` Reader extraction on DOM clone (I-4)
16. `F3-FR2` Reader → PDF render (paginated)
17. `F3-FR4` image fetch/skip in render
18. `F3-FR5` empty-extraction → "try Full Page"
19. `F3-FR3` Reader → EPUB (gated R-6)
20. `F3-FR6` filename from title (wires F6-FR3)
21. `F4-FR1` Full Page triggers (menu + popup)
22. `F4-FR2` Full Page serialize + rasterize → paginated PDF
23. `F4-FR3` tall-page tiling/stitch + scroll-trigger
24. `F4-FR4` cross-origin taint handling
25. `F4-FR5` best-effort labeling copy

**Phase 3 — Public Cloud delivery (F5)**
26. `F5-FR1` API profile (host/header data) + spike doc *(spike; mocked tests)*
27. `F5-FR2` `uploadToCloud` apply→PUT→finish (+ md5/size)
28. `F5-FR3` resolve/cache `Document/` folder id (paginated)
29. `F5-FR4` per-step success/auth checks → F2/F9 routing
30. `F5-FR6` finish-gated done (job FSM, I-3)
31. `F5-FR5` destination audit (integration test, D-3)

**Phase 4 — Send UX (F6)**
32. `F6-FR1` toolbar action → default send
33. `F6-FR2` context menu items (reader/full)
34. `F6-FR5` notifications + badge transitions
35. `F6-FR4` confirm-filename prompt
36. `F6-FR6` popup (state, one-off send, job history)

**Phase 5 — Settings (F7)**
37. `F7-FR1` settings store + Options panels
38. `F7-FR2` folder picker (normalize isFolder) + ListFolders
39. `F7-FR4` immediate-effect settings
40. `F7-FR5` privacy link + "password never stored"
41. `F7-FR6` onboarding sync-expectation/target-match copy
42. `F7-FR3` private cloud section + HTTP warning (depends on F8 connect)

**Phase 6 — Private Cloud (F8)**
43. `F8-FR1` base-URL validation + runtime host permission + reuse login
44. `F8-FR2` `uploadToPrivateCloud` (apply+nonce/ts → multipart POST<applyUrl> → finish)
45. `F8-FR3` private `Document/` resolve ("Y"/"N" normalize)
46. `F8-FR6` auth vs connection-error classification
47. `F8-FR5` private disconnect
48. `F8-FR7` non-HTTPS warning (R-10)
49. `F8-FR4` fallback wiring (public→private, same blob)

**Phase 7 — Resilience (F9)**
50. `F9-FR1` capped pending queue + retry-after-reconnect
51. `F9-FR5` persistence across SW restart + TTL prune
52. `F9-FR4` per-path feature flags + resolveTarget
53. `F9-FR2` non-auth failure → private fallback (same blob)
54. `F9-FR3` per-target health check on connect

**Phase 8 — Privacy & Web Store (F10)**
55. `F10-FR3` guard: no secret to `chrome.storage.sync`
56. `F10-FR4` guard: no runtime remote code (deps bundled)
57. `F10-FR6` manifest no-identity + no third-party share
58. `F10-FR1` PRIVACY.md
59. `F10-FR2` PERMISSIONS.md
60. `F10-FR5` SECURITY-REVIEW.md (attach deferred-audit placeholders)

> 60 FR commits + 1 `docs:` commit (this architecture + ADRs, NOT an FR). The engineer should
> treat the order as the default critical path; reorder only within a phase if a dependency forces it.

---

## 11. Risk → architecture mitigation map

| Risk | Mitigation in this design |
|------|---------------------------|
| R-1 endpoint breakage | per-path feature flags (`shared/feature-flags.ts`), health check, profile-as-data |
| R-2 integration unknowns | F5-FR1 spike pins host/header; `HttpClient` port makes the SW fetch directly (no CORS) |
| R-3 full-page fidelity | UI labeling (F4-FR5); Reader default; render isolated in offscreen for later server swap |
| R-7 countryCode | `domain/auth.ts` `CountryCode` defaults `"1"`, Options field only if spike requires |
| R-8 host/header divergence | `domain/delivery.ts` `ApiProfile`; `supernote.apiHost` storage key; both hosts in manifest |
| R-9 shared-auth fallback limit | documented in `delivery/fallback.ts` comment citing spec; flags bound endpoint-only blast radius |
| R-10 HTTP-over-LAN | `F8-FR7` warning in Options; security review records it |
```
