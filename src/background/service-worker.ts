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
import { runHealthCheck } from '@jobs/health-check';
import { SettingsStore } from '@settings/settings-store';
import { TokenStore } from '@auth/token-store';
import { PrivateCloudStore } from '@auth/private-cloud-store';
import { connectPrivateCloud } from '@auth/connect-private-cloud';
import { formatLoginError } from '@auth/login-routine';
import { ACCESS_TOKEN_COOKIE, captureCloudToken, CLOUD_WEB_URL } from '@auth/cloud-session';
import { reflectConnectionState } from '@auth/connection-state';
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
import { OffscreenReaderExtractor } from './offscreen-reader';
import { ScriptingExtractor } from './scripting-extractor';
import { ChromeNotifier } from './notifications';
import { ChromeBadge } from './badge';
import { ChromeOptionsOpener } from './options-opener';
import { ChromeCookieReader } from './cookie-reader';
import { ChromeTabController } from './tab-controller';
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
const cookies = new ChromeCookieReader();
const tabs = new ChromeTabController();
const queue = new JobQueue(store, clock);
const history = new JobHistory(store, clock);

interface SendContext {
  tabId: number;
  /** The target this send goes to (drives target-aware auth-failure handling). */
  target: Target;
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
    capture: {
      extractor: new ScriptingExtractor(ctx.tabId, new OffscreenReaderExtractor(offscreen)),
    },
    render: { renderer: new OffscreenRenderer(offscreen) },
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

async function hasToken(target: Target): Promise<boolean> {
  const token = target === 'privatecloud' ? await privateStore.getToken() : await tokens.getToken();
  return token !== undefined && token.length > 0;
}

function expiredFlagKey(target: Target): string {
  return target === 'privatecloud' ? StorageKeys.privateSessionExpired : StorageKeys.sessionExpired;
}

/** Clear the failing target's token and mark its session expired (F2-FR4/F8-FR6/F2-FR6). */
async function clearTargetToken(target: Target): Promise<void> {
  if (target === 'privatecloud') {
    await privateStore.clearToken();
  } else {
    await tokens.clearToken();
  }
  await store.set(expiredFlagKey(target), true);
}

/** Clear a target's "expired" flag after a successful (re)connect. */
async function clearExpiredFlag(target: Target): Promise<void> {
  await store.remove(expiredFlagKey(target));
}

async function runSend(
  tabId: number,
  hostname: string,
  mode?: CaptureMode,
): Promise<{ ok: boolean; error?: string }> {
  const settings = await settingsStore.get();
  const target = settings.target;
  const cloudToken = (await tokens.getToken()) ?? '';
  // Prefill the reconnect form with the FAILING target's account (F2-FR4/F8-FR6).
  const account =
    target === 'privatecloud' ? await privateStore.getAccount() : await tokens.getAccount();
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
    target,
    cloudToken,
    flags,
    ...(account !== undefined ? { account } : {}),
    ...(privateCloud !== undefined ? { privateCloud } : {}),
    ...(pcFolderId !== undefined ? { privateFolderId: pcFolderId } : {}),
  });
  const folderId = settings.target === 'privatecloud' ? pcFolderId : settings.cloudFolderId;
  try {
    // If the page is already a document (PDF in the browser viewer), send the
    // bytes as-is — there is nothing to capture/convert.
    const pdf = await probePdf(tabId);
    const request = resolveSendRequest(
      settings,
      { hostname },
      {
        ...(mode !== undefined ? { mode } : {}),
        ...(pdf ? { format: 'pdf' as const } : {}),
      },
    );
    const finalRequest = {
      ...request,
      ...(folderId !== undefined ? { folderId } : {}),
      ...(pdf
        ? { source: { bytes: pdf.bytes, contentType: 'application/pdf', title: pdf.title } }
        : {}),
    };
    const result = await recordedSend(history, deps, finalRequest);
    if (!result.ok) {
      console.warn(
        '[send-to-supernote] send failed:',
        result.error.kind,
        '—',
        result.error.message,
      );
      return { ok: false, error: result.error.message };
    }
    return { ok: true };
  } catch (thrown) {
    // A thrown capture/render (e.g. an internal page like the New Tab that can't
    // be scripted) would otherwise leave only a red badge with no explanation.
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    console.warn('[send-to-supernote] send threw:', message);
    await badge.set('error');
    return { ok: false, error: message };
  }
}

/**
 * Detect a PDF page (Chrome's built-in viewer reports `document.contentType ===
 * "application/pdf"`; the URL often has no `.pdf` extension, e.g. arXiv) and
 * fetch its bytes. The send click grants `activeTab` host access, so the SW may
 * fetch the active tab's URL. Returns undefined for normal HTML pages.
 */
async function probePdf(tabId: number): Promise<{ bytes: Uint8Array; title: string } | undefined> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({ contentType: document.contentType, url: location.href, title: document.title }),
  });
  const info = injection?.result as
    | { contentType?: string; url?: string; title?: string }
    | undefined;
  if (info?.contentType !== 'application/pdf' || !info.url) {
    return undefined;
  }
  const downloaded = await http.getBytes(info.url);
  if (downloaded.bytes === undefined) {
    throw new Error(`Could not download the PDF (HTTP ${downloaded.status}).`);
  }
  const title = info.title && info.title.trim().length > 0 ? info.title : pdfTitleFromUrl(info.url);
  return { bytes: downloaded.bytes, title };
}

/** Derive a document title from a PDF URL's last path segment. */
function pdfTitleFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '');
    const last = path.slice(path.lastIndexOf('/') + 1);
    return (last || 'document').replace(/\.pdf$/i, '');
  } catch {
    return 'document';
  }
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

/**
 * Best-effort connect-time health check (F9-FR3): a cheap authenticated call;
 * if the public-Cloud endpoint looks changed AND a Private Cloud is configured,
 * advise switching. Never blocks/breaks connect.
 */
async function healthCheckOnConnect(target: Target): Promise<void> {
  try {
    const cloudToken = (await tokens.getToken()) ?? '';
    const pcBaseUrl = await privateStore.getBaseUrl();
    const pcToken = await privateStore.getToken();
    const privateCloud =
      pcBaseUrl !== undefined && pcToken !== undefined
        ? { baseUrl: pcBaseUrl, token: pcToken }
        : undefined;
    const port = deliveryFactory({
      cloudToken,
      ...(privateCloud !== undefined ? { privateCloud } : {}),
    })(target);
    const result = await runHealthCheck(
      { port, privateCloudConfigured: privateCloud !== undefined },
      target,
    );
    if (!result.healthy && result.recommendPrivateCloud) {
      await notifier.notify({
        level: 'error',
        title: 'Supernote Cloud may be unavailable',
        message:
          'The Cloud endpoint did not respond as expected — consider Private Cloud in Settings.',
      });
    }
  } catch {
    // Health check is advisory only; never block connect on it.
  }
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

interface PrivateConnectMessage {
  account: string;
  password: string;
  baseUrl?: string;
}

/**
 * Private Cloud sign-in runs IN THE SERVICE WORKER against the user's server via
 * the shared login routine. On success, pin the target and retry retained jobs
 * (F9-FR1). Public Supernote Cloud does NOT use this — its login is CAPTCHA/2FA-
 * gated, so it goes through the cookie-capture connect flow below.
 */
async function handlePrivateConnect(
  msg: PrivateConnectMessage,
): Promise<{ ok: boolean; error?: string; detail?: string }> {
  if (!msg.baseUrl) {
    return { ok: false, error: 'Missing Private Cloud server URL.' };
  }
  try {
    const result = await connectPrivateCloud(
      { http, sha256hex: webCryptoSha256Hex, store },
      { baseUrl: msg.baseUrl, account: msg.account, password: msg.password },
    );
    if (!result.ok) {
      return { ok: false, error: result.error.message, detail: formatLoginError(result.error) };
    }
    await settingsStore.setTarget('privatecloud');
    await clearExpiredFlag('privatecloud');
    await retryAfterReconnect('privatecloud');
    await healthCheckOnConnect('privatecloud');
    return { ok: true };
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return { ok: false, error: message, detail: `network · ${message}` };
  }
}

/**
 * Read the official-login session cookie and, when present, persist it as the
 * public-Cloud token, pin the target, and retry retained jobs. Shared by the
 * immediate path (already signed in) and the deferred path (cookie observed
 * after the user signs in on the opened tab).
 */
async function finalizeCloudCapture(): Promise<boolean> {
  const result = await captureCloudToken({ cookies, tokens });
  if (!result.ok) {
    return false;
  }
  await settingsStore.setTarget('cloud');
  await clearExpiredFlag('cloud');
  await retryAfterReconnect('cloud');
  await reflectConnectionState({ tokens, badge });
  await healthCheckOnConnect('cloud');
  return true;
}

/**
 * Begin the Supernote-Cloud connect: capture the session immediately if the
 * user is already signed in on cloud.supernote.com; otherwise open the official
 * login page and arm the cookie watcher to finish the connect once they sign in.
 */
async function beginCloudConnect(): Promise<{ ok: boolean; pending?: boolean }> {
  if (await finalizeCloudCapture()) {
    return { ok: true };
  }
  const tabId = await tabs.open(`${CLOUD_WEB_URL}/#/login`);
  if (tabId !== undefined) {
    await store.set(StorageKeys.cloudConnectTabId, tabId);
  }
  return { ok: false, pending: true };
}

/** Finish a pending cloud connect once the session cookie appears. */
async function onCloudCookieSet(): Promise<void> {
  const pendingTabId = await store.get<number>(StorageKeys.cloudConnectTabId);
  if (pendingTabId === undefined) {
    return; // No connect in progress — ignore unrelated cookie changes.
  }
  if (!(await finalizeCloudCapture())) {
    return; // Cookie not usable yet (e.g. mid-login) — wait for the next change.
  }
  await store.remove(StorageKeys.cloudConnectTabId);
  await tabs.close(pendingTabId);
  await notifier.notify({
    level: 'success',
    title: 'Connected to Supernote Cloud',
    message: 'You can now send pages to your Supernote.',
  });
}

// Capture the session as soon as cloud.supernote.com sets `x-access-token`
// (registered at top level so it survives SW eviction during a slow sign-in).
chrome.cookies.onChanged.addListener((change) => {
  if (
    change.removed ||
    change.cookie.name !== ACCESS_TOKEN_COOKIE ||
    !change.cookie.domain.includes('supernote.com')
  ) {
    return;
  }
  void onCloudCookieSet();
});

chrome.runtime.onInstalled.addListener(() => {
  registerContextMenus();
  void pruneStaleJobs();
});

// On wake, prune stale jobs (jobs themselves persist in chrome.storage.local).
chrome.runtime.onStartup.addListener(() => {
  void pruneStaleJobs();
});

// No chrome.action.onClicked handler: the manifest sets a default_popup, so the
// toolbar click opens the popup (with its Send button) and onClicked never fires.

onContextMenuClicked((mode) => {
  void sendActiveTab(mode);
});

async function sendActiveTab(mode?: CaptureMode): Promise<{ ok: boolean; error?: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    return { ok: false, error: 'No active tab to send.' };
  }
  if (tab.url !== undefined && !/^https?:\/\//i.test(tab.url)) {
    // Internal pages (chrome://, the New Tab page, the Web Store) can't be
    // scripted, so capture would fail — say so instead of a silent red badge.
    return {
      ok: false,
      error: 'This page can’t be captured. Open a normal web page and try again.',
    };
  }
  return runSend(tab.id, hostnameOf(tab.url), mode);
}

// Startup marker — confirms in the SW console which build is live. Reopening the
// popup re-reads from disk, but the SW only re-registers on an extension reload;
// if this line is absent after reloading, the SW is stale (remove + re-add).
console.warn('[send-to-supernote] SW build: one-button + EPUB + reader-fallback');

// Popup/Options forward here. `connect-cloud` runs the cookie-capture flow for
// public Supernote Cloud (CAPTCHA/2FA-gated, so the user signs in on Supernote's
// own page); `connect` performs Private Cloud sign-in (F8); `send` runs the saga
// (F6); `reconnected` retries retained jobs (F9-FR1).
chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender,
    sendResponse: (response: {
      ok: boolean;
      error?: string;
      detail?: string;
      pending?: boolean;
    }) => void,
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
      void sendActiveTab().then(sendResponse);
      return true; // keep the channel open so the popup can show the outcome
    }
    if (msg.type === 'reconnected' && msg.target !== undefined) {
      void retryAfterReconnect(msg.target);
      return undefined;
    }
    if (msg.type === 'connect-cloud') {
      void beginCloudConnect().then(sendResponse);
      return true; // keep the message channel open for the async response
    }
    if (msg.type === 'connect' && msg.account !== undefined && msg.password !== undefined) {
      void handlePrivateConnect({
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
