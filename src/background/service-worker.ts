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
import { recordedSend } from '@jobs/recorded-send';
import { resolveSendRequest } from '@jobs/resolve-send-request';
import { retryPending } from '@jobs/retry-pending';
import { runHealthCheck } from '@jobs/health-check';
import { connectPrivateCloud } from '@auth/connect-private-cloud';
import { formatLoginError } from '@auth/login-routine';
import {
  ACCESS_TOKEN_COOKIE,
  captureCloudToken,
  CLOUD_WEB_URL,
  isSupernoteCookieDomain,
  resolveConnectStoreIds,
} from '@auth/cloud-session';
import { reflectConnectionState } from '@auth/connection-state';
import type { Target } from '@domain/settings';
import { privateCloudNetworkErrorHint } from '@domain/private-cloud-url';
import { normalizeFlags } from '@shared/feature-flags';
import { StorageKeys } from '@shared/storage-keys';
import { api } from '@shared/browser-api';
import type { CaptureMode } from '@domain/capture';
import { webCryptoSha256Hex } from './crypto';
import { registerContextMenus, onContextMenuClicked } from './context-menus';
import {
  http,
  store,
  blobs,
  notifier,
  badge,
  tokens,
  privateStore,
  settingsStore,
  cookies,
  tabs,
  queue,
  history,
  buildDeps,
  deliveryFactory,
  clearExpiredFlag,
  registerOriginStrip,
} from './composition';

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
  const [injection] = await api.scripting.executeScript({
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
): Promise<{ ok: boolean; error?: string; detail?: string; kind?: 'network' | 'auth' }> {
  if (!msg.baseUrl) {
    return { ok: false, error: 'Missing Private Cloud server URL.' };
  }
  try {
    const result = await connectPrivateCloud(
      { http, sha256hex: webCryptoSha256Hex, store },
      { baseUrl: msg.baseUrl, account: msg.account, password: msg.password },
    );
    if (!result.ok) {
      // `auth`: the request reached the login endpoint and was rejected (wrong
      // password / nonce). Explicit so the popup frames it as a sign-in failure
      // rather than relying on the absence of `kind: 'network'`.
      return {
        ok: false,
        kind: 'auth',
        error: result.error.message,
        detail: formatLoginError(result.error),
      };
    }
    await settingsStore.setTarget('privatecloud');
    await clearExpiredFlag('privatecloud');
    await retryAfterReconnect('privatecloud');
    await healthCheckOnConnect('privatecloud');
    return { ok: true };
  } catch (thrown) {
    // A thrown error here means the request never completed (TLS/CORS/connection
    // — no HTTP status). Surface the actionable reachability hint (which appends
    // cert + http://:19072 guidance for HTTPS) instead of a raw network error.
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return {
      ok: false,
      // `network`: the request never reached a login endpoint — the popup shows
      // this hint as-is rather than framing it as a sign-in failure.
      kind: 'network',
      error: privateCloudNetworkErrorHint(msg.baseUrl),
      detail: `network · ${message}`,
    };
  }
}

/**
 * Read the official-login session cookie and, when present, persist it as the
 * public-Cloud token, pin the target, and retry retained jobs. Shared by the
 * immediate path (already signed in) and the deferred path (cookie observed
 * after the user signs in on the opened tab).
 */
async function finalizeCloudCapture(storeIds?: (string | undefined)[]): Promise<boolean> {
  const result = await captureCloudToken({
    cookies,
    tokens,
    ...(storeIds !== undefined ? { storeIds } : {}),
  });
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
 *
 * The immediate capture scans EVERY readable cookie store (default + any granted
 * Incognito/container store) so an existing session is found wherever the user
 * is signed in. The opened login tab's store is recorded so the deferred capture
 * reads the SAME store the user signs in on (Chrome Incognito / Firefox
 * container or private window), where the cookie lives in a non-default store.
 */
async function beginCloudConnect(): Promise<{ ok: boolean; pending?: boolean }> {
  if (await finalizeCloudCapture(await cookies.listStoreIds())) {
    return { ok: true };
  }
  const tab = await tabs.open(`${CLOUD_WEB_URL}/#/login`);
  if (tab.id !== undefined) {
    await store.set(StorageKeys.cloudConnectTabId, tab.id);
    if (tab.cookieStoreId !== undefined) {
      await store.set(StorageKeys.cloudConnectStoreId, tab.cookieStoreId);
    }
  }
  return { ok: false, pending: true };
}

/** Cookie stores to search when finalizing the pending connect for `tabId`. */
async function pendingConnectStoreIds(tabId: number): Promise<(string | undefined)[]> {
  const recorded = await store.get<string>(StorageKeys.cloudConnectStoreId);
  return resolveConnectStoreIds(cookies, tabId, recorded);
}

/** Finish a pending cloud connect once the session cookie appears. */
async function onCloudCookieSet(): Promise<void> {
  const pendingTabId = await store.get<number>(StorageKeys.cloudConnectTabId);
  if (pendingTabId === undefined) {
    return; // No connect in progress — ignore unrelated cookie changes.
  }
  if (!(await finalizeCloudCapture(await pendingConnectStoreIds(pendingTabId)))) {
    return; // Cookie not usable yet (e.g. mid-login) — wait for the next change.
  }
  await clearPendingCloudConnect();
  await tabs.close(pendingTabId);
  await notifier.notify({
    level: 'success',
    title: 'Connected to Supernote Cloud',
    message: 'You can now send pages to your Supernote.',
  });
}

/** Clear the transient pending-connect keys (tab id + its cookie store). */
async function clearPendingCloudConnect(): Promise<void> {
  await store.remove(StorageKeys.cloudConnectTabId);
  await store.remove(StorageKeys.cloudConnectStoreId);
}

/**
 * If the user closes the official-login tab before the session was captured, the
 * connect would otherwise dead-end silently (tab gone, still "Connect…", no
 * reason). Surface ONE actionable notice and clear the pending state. The
 * success path clears the pending tab id BEFORE closing the tab, so the
 * self-close above does not trigger this.
 */
async function onLoginTabClosed(tabId: number): Promise<void> {
  const pendingTabId = await store.get<number>(StorageKeys.cloudConnectTabId);
  if (pendingTabId !== tabId) {
    return;
  }
  await clearPendingCloudConnect();
  await notifier.notify({
    level: 'warning',
    title: 'Supernote sign-in didn’t finish',
    message:
      'Couldn’t read your Supernote session. If you signed in using a private/incognito or container window, allow this extension there (or use a normal window), then click Connect again.',
  });
}

// Capture the session as soon as cloud.supernote.com sets `x-access-token`
// (registered at top level so it survives SW eviction during a slow sign-in).
api.cookies.onChanged.addListener((change) => {
  if (
    change.removed ||
    change.cookie.name !== ACCESS_TOKEN_COOKIE ||
    !isSupernoteCookieDomain(change.cookie.domain)
  ) {
    return;
  }
  void onCloudCookieSet();
});

// Fallback trigger: cookies.onChanged doesn't reliably wake the MV3 service
// worker during a slow (captcha/code) sign-in. When the pending login tab
// settles — a full load OR a SPA hash route change after login — try to
// finalize too. tabs.onUpdated reliably wakes the SW, so the tab gets closed.
api.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete' && changeInfo.url === undefined) {
    return;
  }
  void finalizePendingConnectForTab(tabId);
});

// Dead-end guard: if the user closes the login tab before we captured the
// session, tell them why instead of leaving the popup stuck on "Connect…".
api.tabs.onRemoved.addListener((tabId) => {
  void onLoginTabClosed(tabId);
});

async function finalizePendingConnectForTab(tabId: number): Promise<void> {
  const pendingTabId = await store.get<number>(StorageKeys.cloudConnectTabId);
  if (pendingTabId === tabId) {
    await onCloudCookieSet();
  }
}

// Firefox-only origin-strip webRequest fallback (FF4-FR2). No-op on Chrome and
// when __USE_WEBREQUEST__ is false; the literal-target branch tree-shakes it out.
registerOriginStrip();

api.runtime.onInstalled.addListener(() => {
  registerContextMenus();
  void pruneStaleJobs();
});

// On wake, prune stale jobs (jobs themselves persist in chrome.storage.local).
api.runtime.onStartup.addListener(() => {
  void pruneStaleJobs();
});

// No chrome.action.onClicked handler: the manifest sets a default_popup, so the
// toolbar click opens the popup (with its Send button) and onClicked never fires.

onContextMenuClicked((mode) => {
  void sendActiveTab(mode);
});

async function sendActiveTab(mode?: CaptureMode): Promise<{ ok: boolean; error?: string }> {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
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
api.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender,
    sendResponse: (response: {
      ok: boolean;
      error?: string;
      detail?: string;
      pending?: boolean;
      kind?: 'network' | 'auth';
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
