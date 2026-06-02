/**
 * Resolve the destination folder id for an upload (F6-FR3), shared by the send
 * saga and the Connection Doctor so both pick the same `Document/` folder and
 * never fall back to the (always-rejected) root directory.
 *
 * An explicit folder id wins; otherwise the root listing is queried and the
 * `Document/` folder is matched. Returns undefined when no real folder resolves
 * (no choice AND the root listing failed OR has no Document folder), so the
 * caller can refuse to upload to root rather than attempt a doomed send.
 */
import { findDocumentFolderId, ROOT_DIRECTORY_ID } from '@domain/delivery';
import type { DeliveryPort } from './delivery-port';

export async function resolveDestination(
  port: DeliveryPort,
  folderId?: string,
): Promise<string | undefined> {
  if (folderId !== undefined && folderId.length > 0) {
    return folderId;
  }
  const root = await port.listFolders(ROOT_DIRECTORY_ID);
  return root.ok ? findDocumentFolderId(root.value) : undefined;
}
