/**
 * Popup shell (F6-FR6) — DOM wiring only; decisions live in the covered
 * popup-view model, the connect use cases, and the saga (guard a). Two views:
 *  - sign-in: pick ONE provider (Supernote Cloud OR Private Cloud) and sign in;
 *  - connected: page title + a single Send button (defaults are sufficient).
 * Coverage-excluded host bootstrap (architecture §9.3).
 */
/* c8 ignore start */
import './popup.css';
import { ChromeStorageLocal } from '../background/chrome-storage';
import { ChromePermissionGranter } from '../background/permissions';
import { SettingsStore } from '@settings/settings-store';
import { TokenStore } from '@auth/token-store';
import { PrivateCloudStore } from '@auth/private-cloud-store';
import { resolveSessionState } from '@auth/connection-state';
import { disconnectPublicCloud, disconnectPrivateCloud } from '@auth/disconnect';
import { JobQueue } from '@jobs/job-queue';
import { SystemClock } from '../background/clock';
import { StorageKeys } from '@shared/storage-keys';
import { validateBaseUrl, httpWarningFor } from '@domain/private-cloud-url';
import { DEFAULT_PUBLIC_PROFILE } from '@domain/delivery';
import { api } from '@shared/browser-api';
import type { Target } from '@domain/settings';
import { buildPopupView, connectFailureMessage } from './popup-view';
import { PASSWORD_NEVER_STORED, PRIVACY_PAGE_PATH } from '../options/privacy-copy';

const store = new ChromeStorageLocal();
const tokens = new TokenStore(store);
const privateStore = new PrivateCloudStore(store);
const settings = new SettingsStore(store);

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function show(id: string, visible: boolean): void {
  const el = byId(id);
  if (el) el.hidden = !visible;
}

function providerLabel(target: Target): string {
  return target === 'privatecloud' ? 'Private Cloud' : 'Supernote Cloud';
}

/**
 * `runtime.sendMessage` with one retry. On a cold start the background (Chrome
 * service worker / Firefox event page) may not have attached its `onMessage`
 * listener the instant the popup fires, so the call rejects with "Could not
 * establish connection. Receiving end does not exist." A brief retry lets the
 * background finish starting. The Firefox background now also loads its real
 * module synchronously (so listeners register during evaluation — see
 * vite.config.ts), making this belt-and-suspenders that also covers Chrome SW
 * eviction.
 */
async function sendMessageWithRetry<T>(message: unknown, retries = 1, delayMs = 250): Promise<T> {
  try {
    const response: unknown = await api.runtime.sendMessage(message);
    return response as T;
  } catch (thrown) {
    if (retries <= 0) {
      throw thrown;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return sendMessageWithRetry<T>(message, retries - 1, delayMs);
  }
}

/** Ask the service worker to sign in (the SW's fetch gets the DNR Origin-strip). */
async function requestConnect(payload: {
  target: Target;
  account: string;
  password: string;
  baseUrl?: string;
}): Promise<{ ok: boolean; error?: string; detail?: string; kind?: string }> {
  let res: { ok?: boolean; error?: string; detail?: string; kind?: string } | undefined;
  try {
    res = await sendMessageWithRetry<typeof res>({ type: 'connect', ...payload });
  } catch (thrown) {
    // sendMessage rejects when there is no receiver (SW failed to register its
    // listener — usually a stale/un-reloaded build or a load-time crash).
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return {
      ok: false,
      error:
        'Background service worker did not respond. Reload the extension at chrome://extensions.',
      detail: `sendMessage threw · ${message}`,
    };
  }
  // A resolved-but-undefined response means the SW received the message but its
  // handler did not reply — the loaded build does not handle `connect`.
  if (res === undefined || res === null) {
    return {
      ok: false,
      error:
        'Background service worker returned no response. Reload the extension at chrome://extensions to load the latest build.',
      detail: 'no SW response (stale build?)',
    };
  }
  return {
    ok: res.ok === true,
    ...(res.error !== undefined ? { error: res.error } : {}),
    ...(res.detail !== undefined ? { detail: res.detail } : {}),
    ...(res.kind !== undefined ? { kind: res.kind } : {}),
  };
}

/**
 * Ask the service worker to connect Supernote Cloud. The SW captures the session
 * immediately if already signed in (`ok`), otherwise opens the official login
 * and finishes once the cookie appears (`pending`).
 */
async function requestCloudConnect(): Promise<{ ok: boolean; pending: boolean; reason?: string }> {
  let res: { ok?: boolean; pending?: boolean } | undefined;
  try {
    res = await sendMessageWithRetry<typeof res>({ type: 'connect-cloud' });
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return {
      ok: false,
      pending: false,
      reason: `Service worker unreachable — reload the extension at chrome://extensions (${message}).`,
    };
  }
  if (res === undefined || res === null) {
    return {
      ok: false,
      pending: false,
      reason:
        'Stale service worker — remove and re-add the extension at chrome://extensions to load the latest build.',
    };
  }
  return { ok: res.ok === true, pending: res.pending === true };
}

async function render(): Promise<void> {
  const current = await settings.get();
  // Resolve "connected" for the ACTIVE target — a Private Cloud-only user has no
  // public token, so the popup must check the private JWT (F8 use case #8). The
  // per-target expired flag keeps the expired state visible across reopens (F2-FR6).
  const isPrivate = current.target === 'privatecloud';
  const tokenSource = isPrivate ? privateStore : tokens;
  const expiredKey = isPrivate ? StorageKeys.privateSessionExpired : StorageKeys.sessionExpired;
  const expired = (await store.get<boolean>(expiredKey)) === true;
  const session = await resolveSessionState(tokenSource, expired);
  const account = isPrivate ? await privateStore.getAccount() : await tokens.getAccount();
  const view = buildPopupView(session, account, current);

  const logo = byId<HTMLImageElement>('logo');
  if (logo) logo.src = api.runtime.getURL('icons/icon32.png');

  const privacy = byId<HTMLAnchorElement>('privacy');
  if (privacy) privacy.href = api.runtime.getURL(PRIVACY_PAGE_PATH);
  // Firefox does not auto-dismiss the action popup when the options tab opens
  // (Chrome does), so the popup would otherwise linger over the settings tab.
  // Close it explicitly once the open request is dispatched — same pattern the
  // send (above) and cloud-connect flows use. `Promise.resolve` tolerates both
  // the Promise- and void-returning `openOptionsPage` signatures.
  byId('settings')?.addEventListener('click', () => {
    void Promise.resolve(api.runtime.openOptionsPage()).finally(() => window.close());
  });

  // Build/host indicator — confirms which API host the loaded build targets
  // (a fresh build reads "viewer.supernote.com"; a stale one would read "cloud").
  const apiHost = byId('api-host');
  if (apiHost) apiHost.textContent = `API: ${new URL(DEFAULT_PUBLIC_PROFILE.baseUrl).host}`;

  if (view.canSend) {
    show('view-signin', false);
    show('view-connected', true);
    renderConnected(account, view.selectedTarget);
  } else {
    show('view-connected', false);
    show('view-signin', true);
    renderSignin(view.selectedTarget, session === 'expired');
  }
}

function renderConnected(account: string | undefined, target: Target): void {
  const chip = byId('account-chip');
  if (chip) {
    chip.textContent = account ? `${account} · ${providerLabel(target)}` : providerLabel(target);
  }

  const titleEl = byId('page-title');
  void api.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const title = tabs[0]?.title;
    if (titleEl) titleEl.textContent = title && title.trim() ? title : 'This page';
  });

  byId<HTMLButtonElement>('send')?.addEventListener('click', () => void runSendFromPopup(target));

  byId('signout')?.addEventListener('click', () => {
    const queue = new JobQueue(store, new SystemClock());
    const done =
      target === 'privatecloud'
        ? disconnectPrivateCloud({
            store,
            clearPendingJobs: () => queue.clearTarget('privatecloud'),
          })
        : disconnectPublicCloud({ store, clearPendingJobs: () => queue.clearTarget('cloud') });
    void done.then(() => render());
  });
}

/** Run a send and show the outcome in the popup (instead of a silent red badge). */
async function runSendFromPopup(target: Target): Promise<void> {
  const button = byId<HTMLButtonElement>('send');
  const status = byId('send-status');
  if (button) {
    button.disabled = true;
    button.textContent = 'Sending…';
  }
  if (status) {
    status.textContent = `Sending via ${providerLabel(target)}…`;
    status.hidden = false;
  }

  let res: { ok?: boolean; error?: string } | undefined;
  try {
    res = await sendMessageWithRetry<typeof res>({ type: 'send' });
  } catch (thrown) {
    res = { ok: false, error: thrown instanceof Error ? thrown.message : String(thrown) };
  }

  if (res?.ok === true) {
    if (status)
      status.textContent = `Sent via ${providerLabel(target)} — sync your device to see it.`;
    window.setTimeout(() => window.close(), 1000);
    return;
  }
  if (button) {
    button.disabled = false;
    button.textContent = 'Send to Supernote';
  }
  if (status) status.textContent = `Could not send: ${res?.error ?? 'unknown error'}`;
}

function renderSignin(defaultTarget: Target, expired: boolean): void {
  const note = byId('signin-note');
  if (note)
    note.textContent = expired ? 'Session expired — please reconnect.' : PASSWORD_NEVER_STORED;

  const segCloud = byId<HTMLButtonElement>('seg-cloud');
  const segPrivate = byId<HTMLButtonElement>('seg-private');
  const warning = byId('signin-warning');

  const setProvider = (next: Target): void => {
    segCloud?.classList.toggle('is-active', next === 'cloud');
    segPrivate?.classList.toggle('is-active', next === 'privatecloud');
    show('cloud-connect', next === 'cloud');
    show('signin-form', next === 'privatecloud');
    if (warning) warning.hidden = true;
  };
  setProvider(defaultTarget);
  segCloud?.addEventListener('click', () => setProvider('cloud'));
  segPrivate?.addEventListener('click', () => setProvider('privatecloud'));

  byId<HTMLButtonElement>('connect-cloud-btn')?.addEventListener(
    'click',
    () => void connectCloud(),
  );

  const pcUrl = byId<HTMLInputElement>('pc-url');
  pcUrl?.addEventListener('input', () => {
    const validated = validateBaseUrl(pcUrl.value);
    const message = validated.ok ? httpWarningFor(validated.value) : undefined;
    if (warning) {
      warning.textContent = message ?? '';
      warning.hidden = message === undefined;
    }
  });

  byId<HTMLFormElement>('signin-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitPrivateSignin();
  });
}

/** Connect Supernote Cloud via the official login page (cookie-capture flow). */
async function connectCloud(): Promise<void> {
  const button = byId<HTMLButtonElement>('connect-cloud-btn');
  const statusEl = byId('cloud-connect-status');
  if (statusEl) statusEl.hidden = true;
  if (button) {
    button.disabled = true;
    button.textContent = 'Opening Supernote sign-in…';
  }

  const result = await requestCloudConnect();
  if (result.ok) {
    void render(); // already signed in — captured immediately
    return;
  }
  if (result.pending) {
    // The official login tab is now open and focused. Close the popup so the user
    // signs in there; the background finishes the connect (captures the cookie,
    // closes the tab, shows a "Connected to Supernote Cloud" notification). Keeping
    // the popup open here just stranded the user on a "reopen once connected" note.
    window.close();
    return;
  }
  // Genuine failure to start sign-in — re-enable the button and surface the reason.
  if (button) {
    button.disabled = false;
    button.textContent = 'Connect Supernote Cloud';
  }
  if (statusEl) {
    statusEl.textContent = result.reason ?? 'Could not start sign-in. Please try again.';
    statusEl.hidden = false;
  }
}

async function submitPrivateSignin(): Promise<void> {
  const email = byId<HTMLInputElement>('email')?.value ?? '';
  const password = byId<HTMLInputElement>('password')?.value ?? '';
  const errorEl = byId('signin-error');
  const statusEl = byId('signin-status');
  const button = byId<HTMLButtonElement>('signin-btn');
  if (errorEl) errorEl.hidden = true;
  if (statusEl) statusEl.hidden = true;
  if (button) {
    button.disabled = true;
    button.textContent = 'Signing in…';
  }

  const finish = (ok: boolean, message?: string, detail?: string): void => {
    const pw = byId<HTMLInputElement>('password');
    if (pw) pw.value = ''; // never keep the password in the DOM
    if (button) {
      button.disabled = false;
      button.textContent = 'Sign in';
    }
    if (ok) {
      void render();
      return;
    }
    if (errorEl && message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }
    if (statusEl) {
      statusEl.textContent = detail ?? '';
      statusEl.hidden = detail === undefined;
    }
  };

  const validated = validateBaseUrl(byId<HTMLInputElement>('pc-url')?.value ?? '');
  if (!validated.ok) {
    finish(false, 'Enter a valid server URL (http or https).');
    return;
  }
  // Grant host access for the user-entered origin here (needs the click gesture);
  // the service worker then performs the login fetch.
  const granted = await new ChromePermissionGranter().request(`${validated.value.baseUrl}/*`);
  if (!granted) {
    finish(false, 'Permission to reach that server was not granted.');
    return;
  }
  const result = await requestConnect({
    target: 'privatecloud',
    account: email,
    password,
    baseUrl: validated.value.baseUrl,
  });
  if (result.ok) {
    finish(true);
  } else {
    // A network failure already carries an actionable reachability/cert hint —
    // show it as-is rather than framing it as a sign-in failure.
    finish(false, connectFailureMessage(result), result.detail);
  }
}

void render();
/* c8 ignore stop */
