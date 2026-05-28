/**
 * DeliveryPort (ADR-0004) — one interface, two adapters (public Cloud F5,
 * Private Cloud F8). The saga depends only on this, so target selection and the
 * public->private fallback with the same blob are trivial. Both adapters
 * normalize to the canonical result/failure types in domain/delivery.
 */
import type { Result } from '@shared/result';
import type { DeliveryFailure, Folder } from '@domain/delivery';

/** A blob to upload: bytes + content type + the destination filename. */
export interface UploadInput {
  bytes: Uint8Array;
  contentType: string;
  /** Destination folder id ("0" = root; default = the Document/ folder). */
  directoryId: string;
  fileName: string;
}

export interface UploadResult {
  fileName: string;
  /** The server-side object name recorded at finish (innerName), for reference. */
  innerName: string;
}

/**
 * A delivery target. `uploadDocument` runs the full apply -> upload -> finish
 * sequence and is "done" only after finish reports success (I-3). `listFolders`
 * supports the Document/ resolution + folder picker. `healthCheck` is a cheap
 * authenticated call used on connect (F9-FR3).
 */
export interface DeliveryPort {
  uploadDocument(input: UploadInput): Promise<Result<UploadResult, DeliveryFailure>>;
  listFolders(directoryId: string): Promise<Result<Folder[], DeliveryFailure>>;
  healthCheck(): Promise<Result<void, DeliveryFailure>>;
}
