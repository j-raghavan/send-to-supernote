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
import { sendDocument, type SendDocumentDeps } from '@jobs/send-document';
import { resolveSendRequest } from '@jobs/resolve-send-request';
import { SettingsStore } from '@settings/settings-store';
import { TokenStore } from '@auth/token-store';
import type { Target } from '@domain/settings';
import { PublicCloudAdapter } from '@delivery/public-cloud-adapter';
import { DEFAULT_PUBLIC_PROFILE } from '@domain/delivery';
import type { CaptureMode } from '@domain/capture';
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
const settingsStore = new SettingsStore(store);
const offscreen = new OffscreenManager(new ChromeOffscreenHost());

function buildDeps(tabId: number, token: string, account?: string): SendDocumentDeps {
  return {
    // Private Cloud adapter is added in F8; default to public Cloud for now.
    resolveDelivery: (_target: Target) =>
      new PublicCloudAdapter({ http, profile: DEFAULT_PUBLIC_PROFILE, token }),
    capture: { extractor: new ScriptingExtractor(tabId) },
    render: { renderer: new OffscreenRenderer(offscreen) },
    blobs,
    notifier,
    badge,
    clock,
    hasToken: async (_target: Target) => (await tokens.getToken()) !== undefined,
    ...(account !== undefined ? { account } : {}),
    authDeps: {
      clearToken: () => tokens.clearToken(),
      notifier,
      options: new ChromeOptionsOpener(),
    },
  };
}

async function runSend(tabId: number, hostname: string, mode?: CaptureMode): Promise<void> {
  const settings = await settingsStore.get();
  const token = (await tokens.getToken()) ?? '';
  const account = await tokens.getAccount();
  const deps = buildDeps(tabId, token, account);
  const request = resolveSendRequest(settings, { hostname }, mode ? { mode } : {});
  await sendDocument(deps, request);
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

chrome.runtime.onInstalled.addListener(() => {
  registerContextMenus();
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

// Popup "Send this page" forwards here (it has no active-tab id).
chrome.runtime.onMessage.addListener((message: unknown) => {
  if (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: string }).type === 'send'
  ) {
    void sendActiveTab();
  }
});
/* c8 ignore stop */
