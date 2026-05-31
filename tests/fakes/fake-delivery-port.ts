import { ok, type Result } from '@shared/result';
import type { DeliveryPort, UploadInput, UploadResult } from '../../src/delivery/delivery-port';
import type { DeliveryFailure, Folder } from '@domain/delivery';

/**
 * Scriptable DeliveryPort for use-case tests. Each method returns a canned
 * Result and records its calls so ordering/inputs can be asserted.
 */
export class FakeDeliveryPort implements DeliveryPort {
  uploadCalls: UploadInput[] = [];
  listCalls: string[] = [];
  healthCalls = 0;

  uploadResult: Result<UploadResult, DeliveryFailure> = ok({
    fileName: 'f.pdf',
    innerName: 'inner',
  });
  foldersByDirectory = new Map<string, Result<Folder[], DeliveryFailure>>();
  // Real Supernote accounts always have a `Document` folder at root; model that
  // so the default destination resolves (the saga no longer uploads to root).
  // Tests that need "no Document folder" / a list failure set `foldersByDirectory`.
  defaultFolders: Result<Folder[], DeliveryFailure> = ok([
    { id: 'default-doc', name: 'Document', isFolder: true },
  ]);
  healthResult: Result<void, DeliveryFailure> = ok(undefined);

  uploadDocument(input: UploadInput): Promise<Result<UploadResult, DeliveryFailure>> {
    this.uploadCalls.push(input);
    return Promise.resolve(this.uploadResult);
  }

  listFolders(directoryId: string): Promise<Result<Folder[], DeliveryFailure>> {
    this.listCalls.push(directoryId);
    return Promise.resolve(this.foldersByDirectory.get(directoryId) ?? this.defaultFolders);
  }

  healthCheck(): Promise<Result<void, DeliveryFailure>> {
    this.healthCalls += 1;
    return Promise.resolve(this.healthResult);
  }
}
