# ADR-0001: DDD + Ports-and-Adapters (Hexagonal) architecture

- Status: accepted
- Date: 2026-05-27
- Deciders: Architect agent (per CLAUDE.md: DDD, SOLID/DRY/KISS, reuse-first, ≥97% coverage)

## Context and Problem Statement

The extension integrates **reverse-engineered, non-contractual** Supernote APIs (public Cloud +
self-hosted Private Cloud) that cannot be live-tested without the user's credentials and a device
(spec R-1/R-8/R-9). It also runs in MV3, where DOM rendering must happen in an offscreen document
and `chrome.*` is pervasive. We must reach ≥97% unit-test coverage and never let the password or
page content leak (I-1/I-2). How do we structure the code so the domain logic is fully testable
without real Chrome or network, and so a breaking API change is contained?

## Decision Drivers

- ≥97% coverage with a per-FR commit gate (CLAUDE.md).
- Network and `chrome.*` MUST be mockable (spec: "the network layer MUST be mockable").
- Invariants I-1..I-6 must be enforceable structurally, not by discipline alone.
- KISS — single-developer extension, not a distributed system.

## Considered Options

1. **Hexagonal (ports & adapters) with DDD bounded contexts** — domain/application pure, adapters thin.
2. **Layered MVC by Chrome surface** (background/content/options/popup) with logic inline.
3. **Transaction-script** (procedural functions calling `chrome.*`/`fetch` directly).

## Decision Outcome

Chosen: **Option 1 — Hexagonal + DDD**. Domain (pure values/rules) and application (use cases) have
zero `chrome.*`/`fetch`; all I/O is behind ports (`HttpClient`, `KeyValueStore`, `Renderer`,
`Extractor`, `Notifier`, `Badge`, `BlobTransfer`, `PermissionGranter`, `Clock`, `RandomSource`,
`Logger`). Real adapters live in `src/background`, `src/content`, `src/offscreen`. Seven bounded
contexts: auth, capture, conversion, delivery, jobs, settings, ui (+ shared).

### Consequences

- Good: domain/use-cases unit-tested against fakes → ≥97% reachable; adapters stay thin/excludable.
- Good: invariants enforced by structure (e.g. only the storage adapter touches `chrome.storage`,
  pinned to `.local`; `fetch` exists in exactly one file).
- Good: a breaking API change touches one adapter, not the domain (R-1 blast-radius control).
- Bad/Cost: more interfaces/indirection than a procedural approach — accepted as the price of
  testability and is kept minimal (one `ports.ts`, no DI framework, manual composition root).

## More Information

See `docs/ddd/architecture.md` §2–§6. Composition root = `src/background/service-worker.ts`.
