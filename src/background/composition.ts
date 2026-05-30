/**
 * Composition root — dependency assembly (FF4-FR1/FR2/FR3/FR4, ADR-0001).
 *
 * Holds the cohesive "assemble dependencies" concern extracted from the service
 * worker entry: the real adapter singletons, the `SendContext` shape, `buildDeps`
 * (the send-job dependency graph), the retry `deliveryFactory`, and the
 * token/target helpers. The service-worker entry keeps ONLY orchestration + event
 * wiring. This module holds NO branching/business logic — every decision lives in
 * covered use cases — so it is coverage-excluded (architecture §9.3), same as the
 * service-worker entry.
 *
 * Target gating (FF4-FR2): the render/reader-parse collaborators are selected on
 * the build-time literal `__TARGET__`. Branching on the LITERAL (not a parameter)
 * lets Rollup eliminate the dead branch and tree-shake the offscreen imports out
 * of the Firefox bundle (I-F2 / FF2-FR6). The offscreen manager is constructed
 * lazily and only ever on Chrome, so the Firefox build never references the
 * offscreen classes.
 */
/* c8 ignore start */
import { type SendDocumentDeps } from '@jobs/send-document';
import { JobQueue } from '@jobs/job-queue';
import { JobHistory } from '@jobs/job-history';
import { SettingsStore } from '@settings/settings-store';
import { TokenStore } from '@auth/token-store';
import { PrivateCloudStore } from '@auth/private-cloud-store';
import type { Target } from '@domain/settings';
import { resolveDelivery, type PrivateTargetConfig } from '@delivery/resolve-target';
import { DEFAULT_PUBLIC_PROFILE } from '@domain/delivery';
import { type FeatureFlags } from '@shared/feature-flags';
import { StorageKeys } from '@shared/storage-keys';
import type { CapturePort, Renderer, Stitcher } from '@shared/ports';
import type { PageSize } from '@domain/conversion';
import { captureFullPage, type FullPageDriver } from '@capture/capture-fullpage';
import { WebCryptoRandomSource } from './crypto';
import { offerFallbackPrompt } from './fallback-prompt';
import { FetchHttpClient } from './fetch-http-client';
import { ChromeStorageLocal } from './chrome-storage';
import { IndexedDbBlobTransfer } from './blob-transfer';
import { OffscreenManager } from './offscreen-manager';
import { ChromeOffscreenHost } from './offscreen-host';
import { OffscreenRenderer } from './offscreen-renderer';
import { OffscreenReaderExtractor } from './offscreen-reader';
import { ScriptingExtractor } from './scripting-extractor';
import { ChromeNotifier } from './notifications';
import { ChromeBadge } from './badge';
import { ChromeOptionsOpener } from './options-opener';
import { ChromeCookieReader } from './cookie-reader';
import { ChromeTabController } from './tab-controller';
import { SystemClock } from './clock';
import { OffscreenStitcher } from './offscreen-stitcher';
import { DirectRenderer } from './direct-renderer';
import { DirectReaderParser } from './direct-reader-parser';
import { DirectStitcher } from './direct-stitcher';
import { ChromeCapture, ChromeFullPageDriver } from './chrome-capture';
import { registerOriginStripper } from './origin-stripper.firefox';
import type { ReaderParser } from './reader-parser';

export const http = new FetchHttpClient();
export const store = new ChromeStorageLocal();
export const blobs = new IndexedDbBlobTransfer();
export const notifier = new ChromeNotifier();
export const badge = new ChromeBadge();
export const clock = new SystemClock();
export const tokens = new TokenStore(store);
export const privateStore = new PrivateCloudStore(store);
export const settingsStore = new SettingsStore(store);
export const random = new WebCryptoRandomSource();
export const cookies = new ChromeCookieReader();
export const tabs = new ChromeTabController();
export const queue = new JobQueue(store, clock);
export const history = new JobHistory(store, clock);

// Offscreen is Chrome-only. Constructed lazily, referenced ONLY inside the
// `__TARGET__ === 'chrome'` branches below — on Firefox `__TARGET__` is the
// literal 'firefox', so Rollup drops these branches and tree-shakes the
// offscreen classes out of the Firefox bundle (I-F2 / FF2-FR6).
let offscreenMgr: OffscreenManager | undefined;
function ensureOffscreen(): OffscreenManager {
  return (offscreenMgr ??= new OffscreenManager(new ChromeOffscreenHost()));
}

/** Select the render adapter for the build target (FF4-FR2). */
function makeRenderer(): Renderer {
  return __TARGET__ === 'firefox'
    ? new DirectRenderer(blobs)
    : new OffscreenRenderer(ensureOffscreen());
}

/** Select the reader-parse adapter for the build target (FF4-FR2). */
function makeReaderParser(): ReaderParser {
  return __TARGET__ === 'firefox'
    ? new DirectReaderParser()
    : new OffscreenReaderExtractor(ensureOffscreen());
}

/**
 * Select the Full Page stitch adapter for the build target (FP4-FR2, FP7-FR1).
 * `OffscreenStitcher`/`ensureOffscreen()` are referenced ONLY in the Chrome arm,
 * so Rollup tree-shakes the offscreen stitcher out of the Firefox bundle
 * (FP7-AC1 — the offscreen-free Firefox mechanism, parity with `makeRenderer`).
 */
function makeStitcher(): Stitcher {
  return __TARGET__ === 'firefox'
    ? new DirectStitcher(blobs)
    : new OffscreenStitcher(ensureOffscreen());
}

/** The Full Page viewport-capture adapter (chrome.tabs.captureVisibleTab). */
function makeFullPageCapturer(): CapturePort {
  return new ChromeCapture();
}

/** The platform-side Full Page driver (inject/scroll/restore + keep-alive). */
function makeFullPageDriver(tabId: number, pageSize: PageSize): FullPageDriver {
  return new ChromeFullPageDriver(tabId, pageSize);
}

/**
 * Register the Firefox-only origin-strip webRequest fallback (FF4-FR2). No-op on
 * Chrome or when the `__USE_WEBREQUEST__` build constant is false (DNR is the
 * default on both targets — FF5). The literal branch tree-shakes the listener
 * out of the Chrome bundle.
 */
export function registerOriginStrip(): void {
  if (__TARGET__ === 'firefox' && __USE_WEBREQUEST__) {
    registerOriginStripper();
  }
}

export interface SendContext {
  tabId: number;
  /** The target this send goes to (drives target-aware auth-failure handling). */
  target: Target;
  cloudToken: string;
  account?: string;
  privateCloud?: PrivateTargetConfig;
  privateFolderId?: string;
  flags: FeatureFlags;
}

export function buildDeps(ctx: SendContext): SendDocumentDeps {
  const resolve = (target: Target): ReturnType<typeof resolveDelivery> =>
    resolveDelivery(target, {
      http,
      random,
      clock,
      cloud: { profile: DEFAULT_PUBLIC_PROFILE, token: ctx.cloudToken },
      ...(ctx.privateCloud !== undefined ? { privateCloud: ctx.privateCloud } : {}),
    });
  return {
    resolveDelivery: resolve,
    capture: {
      extractor: new ScriptingExtractor(ctx.tabId, makeReaderParser()),
    },
    render: { renderer: makeRenderer() },
    // Full Page (FP4-FR4): target-gated stitcher (offscreen on Chrome, direct on
    // Firefox) + a `capture` pre-bound to the active tab/target/driver/clock/sleep
    // so the covered saga only hands it the page size. The offscreen stitcher is
    // referenced only via the Chrome arm of makeStitcher so Firefox tree-shakes it.
    fullpage: {
      capture: (pageSize) =>
        captureFullPage({
          tabId: ctx.tabId,
          capture: makeFullPageCapturer(),
          blobs,
          driver: makeFullPageDriver(ctx.tabId, pageSize),
          target: __TARGET__,
          clock,
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        }),
      stitcher: makeStitcher(),
    },
    blobs,
    notifier,
    badge,
    clock,
    hasToken: (target: Target) => hasToken(target),
    flags: ctx.flags,
    ...(ctx.account !== undefined ? { account: ctx.account } : {}),
    // Retain the converted job so reconnect replays it (F9-FR1).
    retainJob: (job) => queue.enqueue({ id: random.uuid(), ...job }),
    authDeps: {
      // Clear the FAILING target's token (F8-FR6 parity with F2-FR4) and mark it
      // expired so the popup/Options still show "expired" after a reopen (F2-FR6).
      clearToken: () => clearTargetToken(ctx.target),
      notifier,
      options: new ChromeOptionsOpener(),
    },
    // F9-FR2: offer the public->private fallback only when a Private Cloud is
    // configured (the saga restricts it to a NON-AUTH public-Cloud send).
    ...(ctx.privateCloud !== undefined
      ? {
          fallback: {
            privatePort: () => resolve('privatecloud'),
            ...(ctx.privateFolderId !== undefined ? { privateFolderId: ctx.privateFolderId } : {}),
            offer: offerFallbackPrompt,
          },
        }
      : {}),
  };
}

export async function hasToken(target: Target): Promise<boolean> {
  const token = target === 'privatecloud' ? await privateStore.getToken() : await tokens.getToken();
  return token !== undefined && token.length > 0;
}

function expiredFlagKey(target: Target): string {
  return target === 'privatecloud' ? StorageKeys.privateSessionExpired : StorageKeys.sessionExpired;
}

/** Clear the failing target's token and mark its session expired (F2-FR4/F8-FR6/F2-FR6). */
export async function clearTargetToken(target: Target): Promise<void> {
  if (target === 'privatecloud') {
    await privateStore.clearToken();
  } else {
    await tokens.clearToken();
  }
  await store.set(expiredFlagKey(target), true);
}

/** Clear a target's "expired" flag after a successful (re)connect. */
export async function clearExpiredFlag(target: Target): Promise<void> {
  await store.remove(expiredFlagKey(target));
}

/** Build the resolveDelivery factory used for retry (no tab/capture needed). */
export function deliveryFactory(ctx: {
  cloudToken: string;
  privateCloud?: PrivateTargetConfig;
}): (target: Target) => ReturnType<typeof resolveDelivery> {
  return (target) =>
    resolveDelivery(target, {
      http,
      random,
      clock,
      cloud: { profile: DEFAULT_PUBLIC_PROFILE, token: ctx.cloudToken },
      ...(ctx.privateCloud !== undefined ? { privateCloud: ctx.privateCloud } : {}),
    });
}
/* c8 ignore stop */
