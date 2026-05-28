# ADR-0004: Single DeliveryPort with public + private adapters

- Status: accepted
- Date: 2026-05-27
- Deciders: Architect agent

## Context and Problem Statement

Two delivery targets (F5 public Cloud, F8 Private Cloud) differ in the upload step (S3 `PUT` of a
pre-signed URL vs multipart `POST` to an apply-returned URL with `timestamp`/`nonce` headers) and in
response envelope (boolean `success` + boolean `isFolder` vs `{code,data}` and string `"Y"/"N"`).
The fallback feature (F8-FR4 / F9-FR2) must re-send the **same already-converted blob** from public
to private without re-capture, and each path must be independently disableable (I-6 / F9-FR4).

## Decision Drivers

- Reuse the converted blob across targets (no re-capture) for fallback.
- Per-path feature flags (I-6).
- Normalize two envelope shapes to one canonical result so call sites see one type.

## Considered Options

1. **One `DeliveryPort` interface, two adapters** (public-cloud-adapter, private-cloud-adapter).
2. Two unrelated upload functions called directly by the saga.

## Decision Outcome

Chosen: **Option 1**. `delivery/delivery-port.ts` defines `apply`, `upload`, `finish`, `listFolders`,
`healthCheck`, returning canonical domain types. `domain/delivery.ts` holds the envelope normalizer
(`success` truthiness OR OK `code`; surfaces `E0401` from either) and `isAuthFailure` (HTTP 401 OR
`errorCode:"E0401"`). `delivery/resolve-target.ts` selects the adapter by `settings.target` AND the
per-path feature flag; `delivery/fallback.ts` offers public→private with the same `BlobHandle`. The
private adapter does NOT hardcode the upload path — it uses the URL returned by `apply` (commonly
`/api/oss/upload`).

**Private Cloud OSS transfer step (F8-FR6):** the multipart upload to the apply-issued URL is a **raw
byte transfer** — success is **HTTP 2xx, no envelope required** (a real server may return a bare 200
with no JSON body); it fails only on a non-2xx status or an *explicit* failure envelope
(`success:false` / `E0401`). This is the `isTransferOk(status, rawJson)` domain helper. By contrast,
`apply` and `finish` remain **envelope-strict**; document integrity is still guaranteed by the
finish gate (I-3), not by the transfer step's body.

### Consequences

- Good: the saga (`jobs/send-document.ts`) depends only on `DeliveryPort` → trivial fallback + flags.
- Good: one canonical result type → auth/non-auth branching tested once in the domain.
- Good: R-9 limitation (shared auth) documented in `fallback.ts` comment citing the spec.
- Bad/Cost: the port must be the union of both targets' needs (e.g. apply returns either an S3 URL or
  an upload URL). Modeled with a discriminated result; small and explicit.

## More Information

`docs/ddd/architecture.md` §3, §6 (F5/F8/F9), §7 (saga), §11 (R-9). Spec Interfaces (both APIs).
