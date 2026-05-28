/**
 * Popup shell (F6-FR6) — DOM wiring only; all decisions are in the covered
 * popup-view model and the saga. Reads connection state + settings, renders the
 * view, starts a send, links to Options, and lists recent job history.
 * Coverage-excluded host bootstrap (architecture §9.3).
 */
/* c8 ignore start */
import { ChromeStorageLocal } from '../background/chrome-storage';
import { SystemClock } from '../background/clock';
import { SettingsStore } from '@settings/settings-store';
import { TokenStore } from '@auth/token-store';
import { resolveSessionState } from '@auth/connection-state';
import { JobHistory } from '@jobs/job-history';
import { buildPopupView } from './popup-view';

async function render(): Promise<void> {
  const store = new ChromeStorageLocal();
  const tokens = new TokenStore(store);
  const settings = await new SettingsStore(store).get();
  const session = await resolveSessionState(tokens);
  const account = await tokens.getAccount();
  const view = buildPopupView(session, account, settings);

  const status = document.getElementById('status');
  if (status) {
    status.textContent = view.status;
  }

  const sendButton = document.getElementById('send') as HTMLButtonElement | null;
  if (sendButton) {
    sendButton.disabled = !view.canSend;
    sendButton.addEventListener('click', () => {
      void chrome.runtime.sendMessage({ type: 'send' });
      window.close();
    });
  }

  document.getElementById('options')?.addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });

  const historyList = document.getElementById('history');
  if (historyList) {
    const entries = await new JobHistory(store, new SystemClock()).list();
    historyList.textContent = entries.map((e) => `${e.outcome}: ${e.fileName}`).join('\n');
  }
}

void render();
/* c8 ignore stop */
