import type { FileStore, StoredFile } from "../../src/core/ports/file-store";

export class MemoryFileStore implements FileStore {
  readonly objects = new Map<string, Uint8Array>();

  async put(key: string, body: Uint8Array): Promise<void> {
    this.objects.set(key, body.slice());
  }

  async get(key: string): Promise<StoredFile | null> {
    const body = this.objects.get(key);
    if (body === undefined) {
      return null;
    }
    return { body: new Blob([body.slice()]).stream() as ReadableStream<Uint8Array>, sizeBytes: body.length };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
