/**
 * Service worker entry — composition root (F1-FR1 / F6, ADR-0001).
 *
 * Wires the real adapters (the SOLE FetchHttpClient, ChromeStorageLocal,
 * offscreen renderer, scripting extractor, notifier, badge) to the send-job saga
 * and registers Chrome event listeners (toolbar action, context menu). It holds
 * NO branching/business logic — every decision lives in covered use cases
 * (guard a) — so it is coverage-excluded (architecture §9.3).
 */
/* c8 ignore start */
import { type SendDocumentDeps } from '@jobs/send-document';
import { recordedSend } from '@jobs/recorded-send';
import { resolveSendRequest } from '@jobs/resolve-send-request';
import { JobQueue } from '@jobs/job-queue';
import { JobHistory } from '@jobs/job-history';
import { retryPending } from '@jobs/retry-pending';
import { SettingsStore } from '@settings/settings-store';
import { TokenStore } from '@auth/token-store';
import { PrivateCloudStore } from '@auth/private-cloud-store';
import { connectAccount } from '@auth/connect-account';
import { connectPrivateCloud } from '@auth/connect-private-cloud';
import type { Target } from '@domain/settings';
import { resolveDelivery, type PrivateTargetConfig } from '@delivery/resolve-target';
import { DEFAULT_PUBLIC_PROFILE } from '@domain/delivery';
import { type FeatureFlags, normalizeFlags } from '@shared/feature-flags';
import { StorageKeys } from '@shared/storage-keys';
import type { CaptureMode } from '@domain/capture';
import { webCryptoSha256Hex, WebCryptoRandomSource } from './crypto';
import { offerFallbackPrompt } from './fallback-prompt';
import { FetchHttpClient } from './fetch-http-client';
import { ChromeStorageLocal } from './chrome-storage';
import { IndexedDbBlobTransfer } from './blob-transfer';
import { OffscreenManager } from './offscreen-manager';
import { ChromeOffscreenHost } from './offscreen-host';
import { OffscreenRenderer } from './offscreen-renderer';
import { ScriptingExtractor } from './scripting-extractor';
import { ChromeNotifier } from './notifications';
import { ChromeBadge } from './badge';
import { ChromeOptionsOpener } from './options-opener';
import { SystemClock } from './clock';
import { registerContextMenus, onContextMenuClicked } from './context-menus';

const http = new FetchHttpClient();
const store = new ChromeStorageLocal();
const blobs = new IndexedDbBlobTransfer();
const notifier = new ChromeNotifier();
const badge = new ChromeBadge();
const clock = new SystemClock();
const tokens = new TokenStore(store);
const privateStore = new PrivateCloudStore(store);
const settingsStore = new SettingsStore(store);
const offscreen = new OffscreenManager(new ChromeOffscreenHost());
const random = new WebCryptoRandomSource();
const queue = new JobQueue(store, clock);
const history = new JobHistory(store, clock);

interface SendContext {
  tabId: number;
  cloudToken: string;
  account?: string;
  privateCloud?: PrivateTargetConfig;
  privateFolderId?: string;
  flags: FeatureFlags;
}

function buildDeps(ctx: SendContext): SendDocumentDeps {
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
    capture: { extractor: new ScriptingExtractor(ctx.tabId) },
    render: { renderer: new OffscreenRenderer(offscreen) },
    blobs,
    notifier,
    badge,
    clock,
    hasToken: (target: Target) => hasToken(target),
    flags: ctx.flags,
    ...(ctx.account !== undefined ? { account: ctx.account } : {}),
    authDeps: {
      clearToken: () => tokens.clearToken(),
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

async function hasToken(target: Target): Promise<boolean> {
  const token = target === 'privatecloud' ? await privateStore.getToken() : await tokens.getToken();
  return token !== undefined && token.length > 0;
}

async function runSend(tabId: number, hostname: string, mode?: CaptureMode): Promise<void> {
  const settings = await settingsStore.get();
  const cloudToken = (await tokens.getToken()) ?? '';
  const account = await tokens.getAccount();
  const pcBaseUrl = await privateStore.getBaseUrl();
  const pcToken = await privateStore.getToken();
  const privateCloud =
    pcBaseUrl !== undefined && pcToken !== undefined
      ? { baseUrl: pcBaseUrl, token: pcToken }
      : undefined;
  const pcFolderId = await privateStore.getFolderId();
  const flags = normalizeFlags(await store.get(StorageKeys.featureFlags));
  const deps = buildDeps({
    tabId,
    cloudToken,
    flags,
    ...(account !== undefined ? { account } : {}),
    ...(privateCloud !== undefined ? { privateCloud } : {}),
    ...(pcFolderId !== undefined ? { privateFolderId: pcFolderId } : {}),
  });
  const folderId = settings.target === 'privatecloud' ? pcFolderId : settings.cloudFolderId;
  const request = resolveSendRequest(
    settings,
    { hostname },
    {
      ...(mode !== undefined ? { mode } : {}),
    },
  );
  await recordedSend(history, deps, folderId !== undefined ? { ...request, folderId } : request);
}

/** Build the resolveDelivery factory used for retry (no tab/capture needed). */
function deliveryFactory(ctx: {
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

/** Retry retained jobs after a target reconnects (F9-FR1). */
async function retryAfterReconnect(target: Target): Promise<void> {
  const cloudToken = (await tokens.getToken()) ?? '';
  const pcBaseUrl = await privateStore.getBaseUrl();
  const pcToken = await privateStore.getToken();
  const privateCloud =
    pcBaseUrl !== undefined && pcToken !== undefined
      ? { baseUrl: pcBaseUrl, token: pcToken }
      : undefined;
  await retryPending(
    {
      queue,
      blobs,
      resolveDelivery: deliveryFactory({
        cloudToken,
        ...(privateCloud !== undefined ? { privateCloud } : {}),
      }),
    },
    target,
  );
}

/** Prune stale pending jobs and free their blobs (F9-FR5). */
async function pruneStaleJobs(): Promise<void> {
  const pruned = await queue.prune();
  for (const job of pruned) {
    await blobs.delete(job.blobHandle);
  }
}

function hostnameOf(url: string | undefined): string {
  if (!url) {
    return 'page';
  }
  try {
    return new URL(url).hostname;
  } catch {
    return 'page';
  }
}

interface ConnectMessage {
  target: Target;
  account: string;
  password: string;
  baseUrl?: string;
}

/**
 * Run sign-in IN THE SERVICE WORKER so the DNR Origin-strip rule applies to the
 * fetch (viewer.supernote.com 403s when a browser Origin header is present —
 * F5-FR1 spike). On success, pin the target and retry any retained jobs (F9-FR1).
 * Returns a serializable result for the popup/Options page.
 */
async function handleConnect(msg: ConnectMessage): Promise<{ ok: boolean; error?: string }> {
  const loginDeps = { http, sha256hex: webCryptoSha256Hex, random };
  if (msg.target === 'privatecloud') {
    if (!msg.baseUrl) {
      return { ok: false, error: 'Missing Private Cloud server URL.' };
    }
    const result = await connectPrivateCloud(
      { ...loginDeps, store },
      { baseUrl: msg.baseUrl, account: msg.account, password: msg.password },
    );
    if (!result.ok) {
      return { ok: false, error: result.error.message };
    }
    await settingsStore.setTarget('privatecloud');
    await retryAfterReconnect('privatecloud');
    return { ok: true };
  }
  const result = await connectAccount(
    { ...loginDeps, tokens },
    { account: msg.account, password: msg.password },
  );
  if (!result.ok) {
    return { ok: false, error: result.error.message };
  }
  await settingsStore.setTarget('cloud');
  await retryAfterReconnect('cloud');
  return { ok: true };
}

chrome.runtime.onInstalled.addListener(() => {
  registerContextMenus();
  void pruneStaleJobs();
});

// On wake, prune stale jobs (jobs themselves persist in chrome.storage.local).
chrome.runtime.onStartup.addListener(() => {
  void pruneStaleJobs();
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) {
    void runSend(tab.id, hostnameOf(tab.url));
  }
});

onContextMenuClicked((mode) => {
  void sendActiveTab(mode);
});

async function sendActiveTab(mode?: CaptureMode): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) {
    await runSend(tab.id, hostnameOf(tab.url), mode);
  }
}

// Popup/Options forward here. Network runs in the SW so the DNR Origin-strip
// applies: `connect` performs sign-in (F2/F8); `send` runs the saga (F6);
// `reconnected` retries retained jobs (F9-FR1).
chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender,
    sendResponse: (response: { ok: boolean; error?: string }) => void,
  ): boolean | undefined => {
    if (typeof message !== 'object' || message === null) {
      return undefined;
    }
    const msg = message as {
      type?: string;
      target?: Target;
      account?: string;
      password?: string;
      baseUrl?: string;
    };
    if (msg.type === 'send') {
      void sendActiveTab();
      return undefined;
    }
    if (msg.type === 'reconnected' && msg.target !== undefined) {
      void retryAfterReconnect(msg.target);
      return undefined;
    }
    if (
      msg.type === 'connect' &&
      msg.target !== undefined &&
      msg.account !== undefined &&
      msg.password !== undefined
    ) {
      void handleConnect({
        target: msg.target,
        account: msg.account,
        password: msg.password,
        ...(msg.baseUrl !== undefined ? { baseUrl: msg.baseUrl } : {}),
      }).then(sendResponse);
      return true; // keep the message channel open for the async response
    }
    return undefined;
  },
);
/* c8 ignore stop */
