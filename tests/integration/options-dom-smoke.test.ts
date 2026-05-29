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
    <select id="default-format"><option value="epub">e</option><option value="pdf">p</option></select>
    <select id="target"><option value="cloud">c</option><option value="privatecloud">pc</option></select>
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
});
