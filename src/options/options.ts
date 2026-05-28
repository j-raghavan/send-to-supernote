/**
 * Options shell (F7) — DOM wiring only; all decisions live in the covered
 * options-view-model, SettingsStore, and use cases. Renders the connection
 * panel + capture defaults + target + confirm-filename toggle and persists each
 * change immediately to chrome.storage.local (F7-FR1/FR4). Coverage-excluded
 * host bootstrap (architecture §9.3). Folder picker (FR2), Private Cloud (FR3),
 * privacy link (FR5) and onboarding (FR6) are wired in their own commits.
 */
/* c8 ignore start */
import { ChromeStorageLocal } from '../background/chrome-storage';
import { FetchHttpClient } from '../background/fetch-http-client';
import { SettingsStore } from '@settings/settings-store';
import { TokenStore } from '@auth/token-store';
import { resolveSessionState } from '@auth/connection-state';
import { PublicCloudAdapter } from '@delivery/public-cloud-adapter';
import { DEFAULT_PUBLIC_PROFILE, ROOT_DIRECTORY_ID } from '@domain/delivery';
import { listFolders } from '@settings/list-folders';
import { pickFolder, selectableFolders } from '@settings/pick-folder';
import { PASSWORD_NEVER_STORED, PRIVACY_POLICY_URL } from './privacy-copy';
import {
  buildOptionsView,
  parseFormatChange,
  parseModeChange,
  parseTargetChange,
} from './options-view-model';

const store = new ChromeStorageLocal();
const settings = new SettingsStore(store);
const tokens = new TokenStore(store);

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

async function render(): Promise<void> {
  const current = await settings.get();
  const session = await resolveSessionState(tokens);
  const account = await tokens.getAccount();
  const view = buildOptionsView(session, account, current);

  const status = byId('connection-status');
  if (status) {
    status.textContent = view.connectionStatus;
  }

  const mode = byId<HTMLSelectElement>('default-mode');
  if (mode) {
    mode.value = view.defaultMode;
    mode.addEventListener('change', () => {
      const parsed = parseModeChange(mode.value);
      if (parsed) {
        void settings.setDefaultMode(parsed);
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

  const target = byId<HTMLSelectElement>('target');
  if (target) {
    target.value = view.target;
    target.addEventListener('change', () => {
      const parsed = parseTargetChange(target.value);
      if (parsed) {
        void settings.setTarget(parsed);
      }
    });
  }

  const confirm = byId<HTMLInputElement>('confirm-filename');
  if (confirm) {
    confirm.checked = view.confirmFilename;
    confirm.addEventListener('change', () => {
      void settings.setConfirmFilename(confirm.checked);
    });
  }

  if (view.canPickCloudFolder) {
    await renderFolderPicker(current.target);
  }

  renderPrivacy();
}

/** Wire the Privacy Policy link + "password never stored" statement (F7-FR5). */
function renderPrivacy(): void {
  const link = byId<HTMLAnchorElement>('privacy-link');
  if (link) {
    link.href = PRIVACY_POLICY_URL;
  }
  const note = document.querySelector('#connection .note');
  if (note) {
    note.textContent = PASSWORD_NEVER_STORED;
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
  list.replaceChildren();
  for (const folder of selectableFolders(listed.value)) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = folder.name;
    button.addEventListener('click', () => {
      void pickFolder(store, target, folder.id);
    });
    item.appendChild(button);
    list.appendChild(item);
  }
}

void render();
/* c8 ignore stop */
