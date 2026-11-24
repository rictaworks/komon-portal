import type { FileStore, StoredFile } from "../../core/ports/file-store";

/** File bodies in a private R2 bucket. Nothing here ever produces a public URL. */
export class R2FileStore implements FileStore {
  constructor(private readonly bucket: R2Bucket) {}

  async put(key: string, body: Uint8Array): Promise<void> {
    await this.bucket.put(key, body);
  }

  async get(key: string): Promise<StoredFile | null> {
    const object = await this.bucket.get(key);
    return object === null ? null : { body: object.body as ReadableStream<Uint8Array>, sizeBytes: object.size };
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}
