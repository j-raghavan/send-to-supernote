/**
 * Folder listing + Document/ resolution (F5-FR3 / F7-FR2).
 *
 * Uses the DeliveryPort (which paginates list/query internally) and the domain
 * folder helpers to (a) list a folder's children for the picker and (b) resolve
 * the default destination — the `Document/` folder id, NOT root (F5-FR3). Pure
 * orchestration over the port; works for either target (ADR-0004).
 */
import { err, ok, type Result } from '@shared/result';
import type { DeliveryPort } from '../delivery/delivery-port';
import {
  type DeliveryFailure,
  findDocumentFolderId,
  type Folder,
  ROOT_DIRECTORY_ID,
} from '@domain/delivery';

/** List the child folders/files of a directory (default root) for the picker. */
export function listFolders(
  port: DeliveryPort,
  directoryId: string = ROOT_DIRECTORY_ID,
): Promise<Result<Folder[], DeliveryFailure>> {
  return port.listFolders(directoryId);
}

export type ResolveDocumentError =
  | DeliveryFailure
  | { kind: 'no-document-folder'; message: string };

/**
 * Resolve the default destination folder id: the `Document/` folder at root. If
 * the account has no Document folder, surface a clear error rather than silently
 * defaulting to root (Edge Cases: do not silently fall back to root).
 */
export async function resolveDocumentFolderId(
  port: DeliveryPort,
): Promise<Result<string, ResolveDocumentError>> {
  const listed = await port.listFolders(ROOT_DIRECTORY_ID);
  if (!listed.ok) {
    return listed;
  }
  const id = findDocumentFolderId(listed.value);
  if (id === undefined) {
    return err({
      kind: 'no-document-folder',
      message: 'No Document folder found on your Supernote account.',
    });
  }
  return ok(id);
}
