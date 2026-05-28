/**
 * Privacy copy (F7-FR5 / F10-FR1) — covered, pure.
 *
 * The Options page shows a visible Privacy Policy link and a one-line statement
 * that the password is never stored (only a local token). Centralized here so
 * the copy is testable and consistent with the privacy story (D-2/D-3).
 */

/**
 * Intended hosted Privacy Policy URL (F10-FR1). The policy TEXT lives in
 * `docs/PRIVACY.md`; hosting a page at this URL and confirming it is a
 * deferred-to-user deploy step (see docs/PRIVACY.md) before the Web Store listing.
 */
export const PRIVACY_POLICY_URL = 'https://j-raghavan.github.io/send-to-supernote/privacy';

/** The one-line "password never stored" assurance (F7-FR5 / D-2). */
export const PASSWORD_NEVER_STORED =
  'Your password is never stored — only a session token is saved locally on this device.';

/** Short data-flow assurance (no third party, client-only — D-3). */
export const NO_THIRD_PARTY =
  'Your page content goes only to your chosen Supernote target — never to any third party or a server we run.';

/**
 * The positive no-third-party-sharing / no-OAuth story (F10-FR6). Dropbox/Drive
 * were dropped (D-4), so the extension uses no third-party OAuth and shares data
 * with no third party at all.
 */
export const NO_THIRD_PARTY_SHARING =
  'This extension uses no third-party sign-in (no OAuth) and shares your data with no third party.';
