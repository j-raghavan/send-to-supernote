/**
 * Service worker entry — composition root (F1-FR1, ADR-0001).
 *
 * This file wires adapters to use cases and registers Chrome event listeners.
 * It holds NO branching/business logic itself (that lives in the domain and
 * the per-context use cases); it is therefore coverage-excluded (architecture
 * §9.3). Listener registration is fleshed out across F2/F5/F6/F8/F9.
 */

// eslint-disable-next-line no-console
console.info('[Send to Supernote] service worker loaded');
