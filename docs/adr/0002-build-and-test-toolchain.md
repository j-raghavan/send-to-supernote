# ADR-0002: Build & test toolchain — Vite web-extension + Vitest

- Status: accepted
- Date: 2026-05-27
- Deciders: Architect agent

## Context and Problem Statement

F1 needs an MV3-aware build that emits a loadable unpacked extension and a zip, with strict
TypeScript, lint/format gates, and a test runner that can hit ≥97% coverage. MV3 has a multi-entry
graph: service worker (module), content scripts, an offscreen document, options page, popup. Which
bundler + test stack?

## Decision Drivers

- MV3 multi-entry + typed manifest (F1-FR1..FR4).
- One toolchain for build + test (KISS); fast TS/ESM.
- Coverage provider that supports a hard ≥97% threshold gate.
- All conversion libs **bundled**, never CDN (F10-FR4 / I supply-chain).

## Considered Options

1. **Vite `8.0.14` + `@samrum/vite-plugin-web-extension` `5.1.1` + Vitest `4.1.7` (+v8 coverage)**.
2. esbuild + custom manifest emit + Jest/ts-jest.
3. webpack + `@types/chrome` + Karma.

## Decision Outcome

Chosen: **Option 1**. The web-extension plugin consumes a typed `manifest.config.ts`, wires every
MV3 entry, and emits a loadable build; Vitest is Vite-native so build and test share config (one
graph, one resolver). `@vitest/coverage-v8` enforces `lines/branches/functions/statements: 97`.
ESLint `10.4.0` flat config + `typescript-eslint 8.60.0` + Prettier `3.8.3` (`eslint-config-prettier`)
provide the lint/format gates. Chrome mocking via `sinon-chrome 3.0.1` for adapter smoke tests;
domain/use-cases use hand-rolled port fakes. All versions verified present on npm 2026-05-27.

### Consequences

- Good: single fast toolchain; HMR in dev; typed manifest matches F1 exactly.
- Good: deps bundled by Vite → satisfies F10-FR4 (no runtime remote code).
- Bad/Cost: plugin is third-party (vs first-party esbuild). Mitigated: mature (`5.x`), and the
  manifest stays plain data so swapping bundlers later is low-cost.
- Neutral: `npm run check` = lint + format-check + typecheck + `vitest run --coverage` is the
  per-commit gate (CLAUDE.md commit criteria).

## More Information

`docs/ddd/architecture.md` §8 (versions) and §9 (coverage config/excludes).
