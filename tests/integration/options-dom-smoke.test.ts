// @vitest-environment happy-dom
/**
 * DOM-smoke for the wired (c8-ignored) Options shell (src/options/options.ts).
 *
 * options.ts is a thin DOM bootstrap excluded from coverage; its decision logic
 * (the cookie-capture connect, disconnectPublicCloud) is unit-tested elsewhere.
 * This smoke test runs the REAL shell against happy-dom with a faked `chrome`
 * and a faked global `fetch`, then drives the wired controls to confirm the
 * wiring contract holds end-to-end:
 *
 *  (3a) submitting the Connect form asks the service worker to run the official-
 *       login cookie-capture flow ({type:'connect-cloud'}) — Supernote Cloud is
 *       CAPTCHA/2FA-gated, so the page never logs in itself — and shows guidance
 *       to finish on the opened tab.
 *       Clicking Disconnect removes the stored token.
 *
 * Never touches a real Supernote server — fetch and chrome are both faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureModeDescription } from '@capture/copy';

const OPTIONS_HTML = `
  <main>
    <img id="logo" />
    <span id="connection-status">Loading…</span>
    <div id="cloud-connected" hidden><span id="account-chip"></span>
      <button id="disconnect" type="button">Sign out</button>
    </div>
    <div id="cloud-disconnected" hidden>
      <button id="connect-cloud" type="button">Connect Supernote Cloud</button>
      <p id="connect-cloud-hint" hidden></p>
    </div>
    <button id="seg-cloud" type="button">Supernote Cloud</button>
    <button id="seg-private" type="button">Private Cloud</button>
    <div id="cloud-panel"></div>
    <div id="private-panel" hidden></div>
    <select id="default-mode"><option value="reader">r</option><option value="fullpage">f</option></select>
    <span id="default-mode-hint"></span>
    <select id="default-format"><option value="epub">e</option><option value="pdf">p</option></select>
    <input id="confirm-filename" type="checkbox" />
    <ul id="folder-list"></ul>
    <input id="pc-base-url" type="url" />
    <input id="pc-email" type="email" />
    <input id="pc-password" type="password" />
    <p id="password-note"></p>
    <button id="pc-save" type="button"></button>
    <button id="pc-disconnect" type="button"></button>
    <p id="pc-http-warning" hidden></p>
    <p id="onboarding-copy"></p>
    <p id="no-sharing"></p>
    <a id="privacy-link" href="#"></a>
  </main>
`;

interface ChromeFake {
  storage: { local: Map<string, unknown> };
  runtime: { messages: unknown[] };
}

/** Install a minimal chrome.* fake backed by an in-memory map (models .local). */
function installChrome(): ChromeFake {
  const map = new Map<string, unknown>();
  const messages: unknown[] = [];
  const chromeFake = {
    storage: {
      local: {
        get: (keys: string[] | string) =>
          Promise.resolve(
            (Array.isArray(keys) ? keys : [keys]).reduce<Record<string, unknown>>((acc, k) => {
              if (map.has(k)) acc[k] = map.get(k);
              return acc;
            }, {}),
          ),
        set: (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) map.set(k, v);
          return Promise.resolve();
        },
        remove: (keys: string[] | string) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) map.delete(k);
          return Promise.resolve();
        },
      },
    },
    runtime: {
      sendMessage: (msg: unknown) => {
        messages.push(msg);
        return Promise.resolve(undefined);
      },
      onMessage: { addListener: () => undefined },
      getURL: (path: string) => path,
      lastError: undefined,
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = chromeFake;
  return { storage: { local: map }, runtime: { messages } };
}

/** A fetch fake scripting the nonce + login responses (HTTP 200 JSON envelopes). */
function installFetch(): void {
  const fetchFake = vi.fn((input: unknown) => {
    const url = String(input);
    const json = url.includes('query/random/code')
      ? { success: true, randomCode: 'CODE', timestamp: 1 }
      : url.includes('account/login/new')
        ? { success: true, token: 'tok-smoke' }
        : { success: true, userFileVOList: [] }; // list/query etc.
    const response = {
      status: 200,
      ok: true,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
      },
      json: () => Promise.resolve(json),
    } as unknown as Response;
    return Promise.resolve(response);
  });
  (globalThis as unknown as { fetch: unknown }).fetch = fetchFake;
}

/** Wait a microtask turn so the wired async handlers settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Options shell DOM-smoke (wired Connect/Disconnect, F10 wiring)', () => {
  let chromeFake: ChromeFake;

  beforeEach(() => {
    document.body.innerHTML = OPTIONS_HTML;
    chromeFake = installChrome();
    installFetch();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    delete (globalThis as unknown as { fetch?: unknown }).fetch;
  });

  it('Connect asks the service worker to run the official-login capture flow', async () => {
    await import('../../src/options/options');
    await flush(); // initial render()

    document.getElementById('connect-cloud')!.dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush(); // sendMessage + hint update

    // It delegated to the SW cookie-capture flow rather than logging in here.
    expect(chromeFake.runtime.messages).toContainEqual({ type: 'connect-cloud' });
    // With no immediate session, it guides the user to finish on the opened tab.
    expect(document.getElementById('connect-cloud-hint')!.textContent).toContain(
      'Finish signing in',
    );
  });

  it('Disconnect removes the stored token', async () => {
    chromeFake.storage.local.set('supernote.token', 'tok-existing');
    chromeFake.storage.local.set('supernote.account', 'me@x.com');
    await import('../../src/options/options');
    await flush();

    document.getElementById('disconnect')!.dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    await flush();

    expect(chromeFake.storage.local.has('supernote.token')).toBe(false);
  });

  it('renders the default capture-mode picker + hint from stored settings (FP1-FR2 / FP8-FR1)', async () => {
    await import('../../src/options/options');
    await flush(); // initial render()

    const mode = document.getElementById('default-mode') as HTMLSelectElement;
    expect(mode).not.toBeNull();
    expect(Array.from(mode.options).map((o) => o.value)).toEqual(['reader', 'fullpage']);
    const hint = document.getElementById('default-mode-hint')!;
    expect(hint).not.toBeNull();

    // No stored value → defaults to 'reader' with its matching hint.
    expect(mode.value).toBe('reader');
    expect(hint.textContent).toBe(captureModeDescription('reader'));
  });

  it('persists a capture-mode change and updates the hint (FP1-FR2 / FP8-FR1)', async () => {
    await import('../../src/options/options');
    await flush(); // initial render()

    const mode = document.getElementById('default-mode') as HTMLSelectElement;
    const hint = document.getElementById('default-mode-hint')!;

    mode.value = 'fullpage';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    await flush(); // setDefaultMode persist + hint update

    // Persisted via SettingsStore.setDefaultMode → chrome.storage.local.
    expect(chromeFake.storage.local.get('settings.defaultMode')).toBe('fullpage');
    expect(hint.textContent).toBe(captureModeDescription('fullpage'));
  });
});
