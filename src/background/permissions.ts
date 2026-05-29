/**
 * ChromePermissionGranter (F8-FR1) — PermissionGranter port over
 * chrome.permissions. THIN glue: requests the runtime host permission for the
 * user-entered Private Cloud origin (declared under optional_host_permissions,
 * F1-FR3). No decision logic. Coverage-excluded.
 */
/* c8 ignore start */
import type { PermissionGranter } from '@shared/ports';
import { api } from '@shared/browser-api';

export class ChromePermissionGranter implements PermissionGranter {
  request(origin: string): Promise<boolean> {
    return api.permissions.request({ origins: [origin] });
  }
}
/* c8 ignore stop */
