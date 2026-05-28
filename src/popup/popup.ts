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
import { resolveSessionState } from '@auth/connection-state';
import { disconnectPublicCloud, disconnectPrivateCloud } from '@auth/disconnect';
import { validateBaseUrl, httpWarningFor } from '@domain/private-cloud-url';
import { DEFAULT_PUBLIC_PROFILE } from '@domain/delivery';
import type { CaptureMode, Target } from '@domain/settings';
import { buildPopupView } from './popup-view';
import { PASSWORD_NEVER_STORED, PRIVACY_POLICY_URL } from '../options/privacy-copy';

const store = new ChromeStorageLocal();
const tokens = new TokenStore(store);
const settings = new SettingsStore(store);

let provider: Target = 'cloud';

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

/** Ask the service worker to sign in (the SW's fetch gets the DNR Origin-strip). */
async function requestConnect(payload: {
  target: Target;
  account: string;
  password: string;
  baseUrl?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const res: { ok?: boolean; error?: string } | undefined = await chrome.runtime.sendMessage({
    type: 'connect',
    ...payload,
  });
  return { ok: res?.ok === true, ...(res?.error !== undefined ? { error: res.error } : {}) };
}

async function render(): Promise<void> {
  const current = await settings.get();
  const session = await resolveSessionState(tokens);
  const account = await tokens.getAccount();
  const view = buildPopupView(session, account, current);

  const logo = byId<HTMLImageElement>('logo');
  if (logo) logo.src = chrome.runtime.getURL('icons/icon32.png');

  const privacy = byId<HTMLAnchorElement>('privacy');
  if (privacy) privacy.href = PRIVACY_POLICY_URL;
  byId('settings')?.addEventListener('click', () => void chrome.runtime.openOptionsPage());

  // Build/host indicator — confirms which API host the loaded build targets
  // (a fresh build reads "viewer.supernote.com"; a stale one would read "cloud").
  const apiHost = byId('api-host');
  if (apiHost) apiHost.textContent = `API: ${new URL(DEFAULT_PUBLIC_PROFILE.baseUrl).host}`;

  if (view.canSend) {
    show('view-signin', false);
    show('view-connected', true);
    renderConnected(view.selectedMode, account, view.selectedTarget);
  } else {
    show('view-connected', false);
    show('view-signin', true);
    renderSignin(view.selectedTarget, session === 'expired');
  }
}

function renderConnected(mode: CaptureMode, account: string | undefined, target: Target): void {
  const chip = byId('account-chip');
  if (chip) {
    chip.textContent = account ? `${account} · ${providerLabel(target)}` : providerLabel(target);
  }

  const titleEl = byId('page-title');
  void chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const title = tabs[0]?.title;
    if (titleEl) titleEl.textContent = title && title.trim() ? title : 'This page';
  });

  let selected: CaptureMode = mode;
  const reader = byId<HTMLButtonElement>('mode-reader');
  const full = byId<HTMLButtonElement>('mode-fullpage');
  const paintMode = (): void => {
    reader?.classList.toggle('is-active', selected === 'reader');
    full?.classList.toggle('is-active', selected === 'fullpage');
  };
  paintMode();
  reader?.addEventListener('click', () => {
    selected = 'reader';
    paintMode();
    void settings.setDefaultMode('reader');
  });
  full?.addEventListener('click', () => {
    selected = 'fullpage';
    paintMode();
    void settings.setDefaultMode('fullpage');
  });

  byId<HTMLButtonElement>('send')?.addEventListener('click', () => {
    void chrome.runtime.sendMessage({ type: 'send' });
    const status = byId('send-status');
    if (status) {
      status.textContent = `Sending via ${providerLabel(target)} — sync your device to see it.`;
      status.hidden = false;
    }
    window.setTimeout(() => window.close(), 700);
  });

  byId('signout')?.addEventListener('click', () => {
    const done =
      target === 'privatecloud'
        ? disconnectPrivateCloud({ store })
        : disconnectPublicCloud({ store });
    void done.then(() => render());
  });
}

function renderSignin(defaultTarget: Target, expired: boolean): void {
  provider = defaultTarget;
  const note = byId('signin-note');
  if (note)
    note.textContent = expired ? 'Session expired — please sign in again.' : PASSWORD_NEVER_STORED;

  const segCloud = byId<HTMLButtonElement>('seg-cloud');
  const segPrivate = byId<HTMLButtonElement>('seg-private');
  const warning = byId('signin-warning');

  const setProvider = (next: Target): void => {
    provider = next;
    segCloud?.classList.toggle('is-active', next === 'cloud');
    segPrivate?.classList.toggle('is-active', next === 'privatecloud');
    show('pc-url', next === 'privatecloud');
    if (warning) warning.hidden = true;
  };
  setProvider(defaultTarget);
  segCloud?.addEventListener('click', () => setProvider('cloud'));
  segPrivate?.addEventListener('click', () => setProvider('privatecloud'));

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
    void submitSignin();
  });
}

async function submitSignin(): Promise<void> {
  const email = byId<HTMLInputElement>('email')?.value ?? '';
  const password = byId<HTMLInputElement>('password')?.value ?? '';
  const errorEl = byId('signin-error');
  const button = byId<HTMLButtonElement>('signin-btn');
  if (errorEl) errorEl.hidden = true;
  if (button) {
    button.disabled = true;
    button.textContent = 'Signing in…';
  }

  const finish = (ok: boolean, message?: string): void => {
    const pw = byId<HTMLInputElement>('password');
    if (pw) pw.value = ''; // never keep the password in the DOM
    if (button) {
      button.disabled = false;
      button.textContent = 'Sign in';
    }
    if (ok) {
      void render();
    } else if (errorEl && message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }
  };

  const fail = (result: { error?: string }): void =>
    finish(false, `Could not sign in: ${result.error ?? 'unknown error'}`);

  if (provider === 'privatecloud') {
    const validated = validateBaseUrl(byId<HTMLInputElement>('pc-url')?.value ?? '');
    if (!validated.ok) {
      finish(false, 'Enter a valid server URL (http or https).');
      return;
    }
    // Grant host access for the user-entered origin here (this needs the click
    // gesture); the service worker then performs the login fetch.
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
      fail(result);
    }
  } else {
    const result = await requestConnect({ target: 'cloud', account: email, password });
    if (result.ok) {
      finish(true);
    } else {
      fail(result);
    }
  }
}

void render();
/* c8 ignore stop */
