// @vitest-environment happy-dom
/**
 * DOM-smoke for the wired (c8-ignored) Options shell (src/options/options.ts).
 *
 * options.ts is a thin DOM bootstrap excluded from coverage; its decision logic
 * (connectAccount, disconnectPublicCloud, the `reconnected` message) is unit-
 * tested elsewhere. This smoke test runs the REAL shell against happy-dom with a
 * faked `chrome` and a faked global `fetch`, then drives the wired controls to
 * confirm the wiring contract holds end-to-end:
 *
 *  (3a) submitting the Connect form runs the login flow over the (faked) sole
 *       fetch AND posts the {type:'reconnected', target:'cloud'} message that
 *       fires the F9 auto-retry; the password field is cleared; the token is
 *       persisted to the faked chrome.storage.local.
 *       Clicking Disconnect removes the stored token.
 *
 * Never touches a real Supernote server — fetch and chrome are both faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const OPTIONS_HTML = `
  <main>
    <p id="connection-status">Loading…</p>
    <form id="connect-form">
      <input id="email" type="email" />
      <input id="password" type="password" />
      <button id="connect" type="submit">Connect</button>
      <button id="disconnect" type="button">Disconnect</button>
    </form>
    <p class="note" id="note"></p>
    <select id="default-mode"><option value="reader">r</option><option value="fullpage">f</option></select>
    <select id="default-format"><option value="pdf">p</option><option value="epub">e</option></select>
    <select id="target"><option value="cloud">c</option><option value="privatecloud">pc</option></select>
    <input id="confirm-filename" type="checkbox" />
    <ul id="folder-list"></ul>
    <input id="pc-base-url" type="url" />
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

  it('Connect runs the login flow, persists the token, posts `reconnected`, clears the password', async () => {
    await import('../../src/options/options');
    await flush(); // initial render()

    (document.getElementById('email') as HTMLInputElement).value = 'me@x.com';
    (document.getElementById('password') as HTMLInputElement).value = 'pw-secret';

    document
      .getElementById('connect-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    await flush(); // login + persist + notify + re-render

    // The token was persisted to the faked chrome.storage.local.
    expect(chromeFake.storage.local.get('supernote.token')).toBe('tok-smoke');
    // The F9 auto-retry trigger fired.
    expect(chromeFake.runtime.messages).toContainEqual({ type: 'reconnected', target: 'cloud' });
    // The password is not kept in the DOM after connect.
    expect((document.getElementById('password') as HTMLInputElement).value).toBe('');
    // And it was never written to storage (D-2).
    expect([...chromeFake.storage.local.values()].join(',')).not.toContain('pw-secret');
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
