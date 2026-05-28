/**
 * Folder picker persistence (F7-FR2) — covered, pure orchestration.
 *
 * Browsing the folder tree reuses the DeliveryPort.listFolders use case (which
 * paginates and normalizes isFolder for both boolean and "Y"/"N"). Selecting a
 * default destination stores it under the target's key: settings.cloudFolderId
 * (public) or privatecloud.folderId (private). Only folders (not files) are
 * selectable.
 */
import type { KeyValueStore } from '@shared/ports';
import { StorageKeys } from '@shared/storage-keys';
import type { Folder } from '@domain/delivery';
import type { Target } from '@domain/settings';

/** Keep only the folder entries from a listing (files are not destinations). */
export function selectableFolders(entries: readonly Folder[]): Folder[] {
  return entries.filter((entry) => entry.isFolder);
}

/** The storage key the chosen folder id is persisted under for a target. */
export function folderKeyForTarget(target: Target): string {
  return target === 'privatecloud' ? StorageKeys.privateFolderId : StorageKeys.cloudFolderId;
}

/** Persist the chosen destination folder id for the given target (F7-FR2). */
export async function pickFolder(
  store: KeyValueStore,
  target: Target,
  folderId: string,
): Promise<void> {
  await store.set(folderKeyForTarget(target), folderId);
}
