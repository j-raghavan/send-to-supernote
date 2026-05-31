/**
 * Options shell (F7) — DOM wiring only; all decisions live in the covered
 * options-view-model, SettingsStore, and use cases. Renders the Supernote Cloud
 * connect state, Private Cloud form, capture defaults, destination folder, and
 * onboarding/privacy, persisting each change immediately to chrome.storage.local
 * (F7-FR1/FR4). Coverage-excluded host bootstrap (architecture §9.3).
 */
/* c8 ignore start */
import './options.css';
import { ChromeStorageLocal } from '../background/chrome-storage';
import { FetchHttpClient } from '../background/fetch-http-client';
import { ChromePermissionGranter } from '../background/permissions';
import { webCryptoSha256Hex } from '../background/crypto';
import { SystemClock } from '../background/clock';
import { SettingsStore } from '@settings/settings-store';
import { TokenStore } from '@auth/token-store';
import { PrivateCloudStore } from '@auth/private-cloud-store';
import { resolveSessionState } from '@auth/connection-state';
import { disconnectPublicCloud, disconnectPrivateCloud } from '@auth/disconnect';
import { connectPrivateCloud } from '@auth/connect-private-cloud';
import { formatLoginError } from '@auth/login-routine';
import { JobQueue } from '@jobs/job-queue';
import { StorageKeys } from '@shared/storage-keys';
import { PublicCloudAdapter } from '@delivery/public-cloud-adapter';
import { DEFAULT_PUBLIC_PROFILE, ROOT_DIRECTORY_ID } from '@domain/delivery';
import {
  httpWarningFor,
  privateCloudNetworkErrorHint,
  validateBaseUrl,
} from '@domain/private-cloud-url';
import { listFolders } from '@settings/list-folders';
import { folderKeyForTarget, pickFolder, selectableFolders } from '@settings/pick-folder';
import { onboardingCopy } from '@settings/onboarding';
import { NO_THIRD_PARTY_SHARING, PASSWORD_NEVER_STORED, PRIVACY_PAGE_PATH } from './privacy-copy';
import { buildOptionsView, parseFormatChange, parseModeChange } from './options-view-model';
import { captureModeDescription } from '@capture/copy';
import { api } from '@shared/browser-api';

const store = new ChromeStorageLocal();
const settings = new SettingsStore(store);
const tokens = new TokenStore(store);
const privateStore = new PrivateCloudStore(store);

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

async function render(): Promise<void> {
  const current = await settings.get();
  const expired = (await store.get<boolean>(StorageKeys.sessionExpired)) === true;
  const session = await resolveSessionState(tokens, expired);
  const account = await tokens.getAccount();
  const view = buildOptionsView(session, account, current);

  const logo = byId<HTMLImageElement>('logo');
  if (logo) logo.src = api.runtime.getURL('icons/icon512.png');

  const status = byId('connection-status');
  if (status) {
    status.textContent = view.connectionStatus;
    // When connected, the panel below already shows the state — avoid a redundant
    // (and previously contradictory) header chip.
    status.hidden = view.connected;
  }

  // Toggle the Supernote Cloud connected vs disconnected panels.
  const connectedPanel = byId('cloud-connected');
  if (connectedPanel) connectedPanel.hidden = !view.connected;
  const disconnectedPanel = byId('cloud-disconnected');
  if (disconnectedPanel) disconnectedPanel.hidden = view.connected;
  const chip = byId('account-chip');
  if (chip) chip.textContent = view.account ?? 'Connected to Supernote Cloud';

  // Reflect the Private Cloud session in its own panel (target-aware, like the popup).
  const pcExpired = (await store.get<boolean>(StorageKeys.privateSessionExpired)) === true;
  const pcSession = await resolveSessionState(privateStore, pcExpired);
  const pcStatus = byId('pc-connection-status');
  if (pcStatus) {
    pcStatus.textContent =
      pcSession === 'connected'
        ? 'Connected'
        : pcSession === 'expired'
          ? 'Session expired — reconnect'
          : 'Not connected';
  }

  const mode = byId<HTMLSelectElement>('default-mode');
  const modeHint = byId('default-mode-hint');
  if (mode) {
    mode.value = view.defaultMode;
    if (modeHint) {
      modeHint.textContent = captureModeDescription(view.defaultMode);
    }
    mode.addEventListener('change', () => {
      const parsed = parseModeChange(mode.value);
      if (parsed) {
        void settings.setDefaultMode(parsed);
        if (modeHint) {
          modeHint.textContent = captureModeDescription(parsed);
        }
      }
    });
  }

  const format = byId<HTMLSelectElement>('default-format');
  if (format) {
    format.value = view.defaultFormat;
    format.addEventListener('change', () => {
      const parsed = parseFormatChange(format.value);
      if (parsed) {
        void settings.setDefaultFormat(parsed);
      }
    });
  }

  wireProviderTabs(view.target);

  if (view.canPickCloudFolder) {
    await renderFolderPicker(current.target);
  }

  renderOnboarding(current.target);
  renderPrivacy();
  wireConnection();
  wirePrivateCloud();
}

/** Notify the service worker that a target (re)connected, so F9 auto-retries (F9-FR1). */
function notifyReconnected(target: 'cloud' | 'privatecloud'): void {
  void api.runtime.sendMessage({ type: 'reconnected', target });
}

/**
 * Wire the public-Cloud Connect / Disconnect form (F2 via Options, F7-FR1).
 * Supernote Cloud sign-in is CAPTCHA/2FA-gated, so the extension does not log in
 * itself: it opens Supernote's official login and captures the session cookie
 * (handled in the service worker). The form just kicks that off.
 */
function wireConnection(): void {
  byId<HTMLButtonElement>('connect-cloud')?.addEventListener('click', () => {
    const hint = byId('connect-cloud-hint');
    void api.runtime
      .sendMessage({ type: 'connect-cloud' })
      .then((res: { ok?: boolean } | undefined) => {
        if (res?.ok === true) {
          notifyReconnected('cloud');
          void render();
        } else if (hint) {
          hint.textContent =
            'Finish signing in on the Supernote tab — this page updates once connected.';
          hint.hidden = false;
        }
      });
  });

  byId<HTMLButtonElement>('disconnect')?.addEventListener('click', () => {
    const queue = new JobQueue(store, new SystemClock());
    void disconnectPublicCloud({
      store,
      clearPendingJobs: () => queue.clearTarget('cloud'),
    }).then(() => render());
  });
}

/** Wire the Private Cloud base-URL entry + R-10 warning + connect (F7-FR3). */
function wirePrivateCloud(): void {
  const input = byId<HTMLInputElement>('pc-base-url');
  const saveButton = byId<HTMLButtonElement>('pc-save');
  const warning = byId('pc-http-warning');
  const emailInput = byId<HTMLInputElement>('pc-email');
  const passwordInput = byId<HTMLInputElement>('pc-password');
  if (!input || !saveButton) {
    return;
  }

  input.addEventListener('input', () => {
    const validated = validateBaseUrl(input.value);
    showWarning(warning, validated.ok ? httpWarningFor(validated.value) : undefined);
  });

  const errorEl = byId('pc-error');
  const statusEl = byId('pc-status');

  saveButton.addEventListener('click', () => {
    const validated = validateBaseUrl(input.value);
    // Clear prior failure copy on each attempt (the warning strip is advisory only).
    showWarning(errorEl, undefined);
    showWarning(statusEl, undefined);
    if (!validated.ok) {
      showWarning(warning, 'Enter a valid http(s) server URL.');
      return;
    }
    showWarning(warning, httpWarningFor(validated.value));
    void connectPrivateCloud(
      {
        http: new FetchHttpClient(),
        sha256hex: webCryptoSha256Hex,
        store,
      },
      {
        baseUrl: validated.value.baseUrl,
        account: emailInput?.value ?? '',
        password: passwordInput?.value ?? '',
      },
    )
      .then((result) => {
        if (result.ok) {
          void new ChromePermissionGranter().request(`${validated.value.baseUrl}/*`);
          notifyReconnected('privatecloud');
        } else {
          // Login reached the server but was rejected (wrong password / nonce):
          // a hard failure (red), with the password-free diagnostic as detail —
          // matching the popup's error + status presentation.
          showWarning(errorEl, `Could not sign in: ${result.error.message}`);
          showWarning(statusEl, formatLoginError(result.error));
        }
      })
      .catch((thrown: unknown) => {
        // The request never reached a login endpoint (network/TLS) — surface the
        // same actionable reachability/cert hint the popup uses (as a hard error,
        // not the advisory warning strip), keeping the raw error as detail.
        showWarning(errorEl, privateCloudNetworkErrorHint(validated.value.baseUrl));
        showWarning(
          statusEl,
          `network · ${thrown instanceof Error ? thrown.message : String(thrown)}`,
        );
      });
  });

  byId<HTMLButtonElement>('pc-disconnect')?.addEventListener('click', () => {
    const queue = new JobQueue(store, new SystemClock());
    void disconnectPrivateCloud({
      store,
      clearPendingJobs: () => queue.clearTarget('privatecloud'),
    }).then(() => render());
  });
}

/**
 * Wire the Supernote Cloud / Private Cloud tabs (the send target is one OR the
 * other). Selecting a tab shows that provider's panel and pins it as the target.
 */
function wireProviderTabs(initialTarget: 'cloud' | 'privatecloud'): void {
  const segCloud = byId<HTMLButtonElement>('seg-cloud');
  const segPrivate = byId<HTMLButtonElement>('seg-private');

  const show = (target: 'cloud' | 'privatecloud'): void => {
    segCloud?.classList.toggle('is-active', target === 'cloud');
    segPrivate?.classList.toggle('is-active', target === 'privatecloud');
    const cloudPanel = byId('cloud-panel');
    if (cloudPanel) cloudPanel.hidden = target !== 'cloud';
    const privatePanel = byId('private-panel');
    if (privatePanel) privatePanel.hidden = target !== 'privatecloud';
    renderOnboarding(target);
  };

  show(initialTarget);
  segCloud?.addEventListener('click', () => {
    void settings.setTarget('cloud');
    show('cloud');
  });
  segPrivate?.addEventListener('click', () => {
    void settings.setTarget('privatecloud');
    show('privatecloud');
  });
}

function showWarning(el: HTMLElement | null, message: string | undefined): void {
  if (!el) {
    return;
  }
  el.textContent = message ?? '';
  el.hidden = message === undefined;
}

/** Render the sync-expectation + target-match onboarding copy (F7-FR6). */
function renderOnboarding(target: 'cloud' | 'privatecloud'): void {
  const copy = byId('onboarding-copy');
  if (copy) {
    copy.textContent = onboardingCopy(target);
  }
}

/** Wire the Privacy Policy link + "password never stored" + no-sharing copy (F7-FR5 / F10-FR6). */
function renderPrivacy(): void {
  const link = byId<HTMLAnchorElement>('privacy-link');
  if (link) {
    link.href = api.runtime.getURL(PRIVACY_PAGE_PATH);
  }
  const note = byId('password-note');
  if (note) {
    note.textContent = PASSWORD_NEVER_STORED;
  }
  const sharing = byId('no-sharing');
  if (sharing) {
    sharing.textContent = NO_THIRD_PARTY_SHARING;
  }
}

/** Render the destination-folder picker for the public Cloud target (F7-FR2). */
async function renderFolderPicker(target: 'cloud' | 'privatecloud'): Promise<void> {
  const list = byId<HTMLUListElement>('folder-list');
  if (!list) {
    return;
  }
  const token = (await tokens.getToken()) ?? '';
  const port = new PublicCloudAdapter({
    http: new FetchHttpClient(),
    profile: DEFAULT_PUBLIC_PROFILE,
    token,
  });
  const listed = await listFolders(port, ROOT_DIRECTORY_ID);
  if (!listed.ok) {
    list.textContent = 'Could not load folders.';
    return;
  }
  // The folder currently saved as this target's destination, so we can show the
  // user which one their sends go to (F7-FR2 UX). Undefined → none chosen yet, so
  // the card's "Defaults to Document/" hint applies and nothing is highlighted.
  const selectedId = await store.get<string>(folderKeyForTarget(target));
  list.replaceChildren();

  // Exactly one button carries the selected styling at a time; clicking re-marks
  // immediately so the choice is visible without a reload.
  const markSelected = (chosen: HTMLButtonElement): void => {
    for (const btn of list.querySelectorAll('button')) {
      const isChosen = btn === chosen;
      btn.classList.toggle('is-selected', isChosen);
      if (isChosen) {
        btn.setAttribute('aria-current', 'true');
      } else {
        btn.removeAttribute('aria-current');
      }
    }
  };

  for (const folder of selectableFolders(listed.value)) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = folder.name;
    if (folder.id === selectedId) {
      button.classList.add('is-selected');
      button.setAttribute('aria-current', 'true');
    }
    button.addEventListener('click', () => {
      markSelected(button);
      void pickFolder(store, target, folder.id);
    });
    item.appendChild(button);
    list.appendChild(item);
  }
}

void render();
/* c8 ignore stop */
