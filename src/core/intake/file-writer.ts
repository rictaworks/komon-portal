import { conflict, notFound } from "../model/errors";
import type { FileRecord } from "../model/types";
import type { Clock } from "../ports/clock";
import type { FileWriteResult, Repository } from "../ports/repository";
import { localDateOf } from "../time/local-date";
import { buildDisplayName } from "./display-name";

const NAME_ATTEMPTS = 5;

type WriterRepository = Pick<Repository, "files" | "clients" | "docTypes" | "settings">;

/** Writes file records, generating the display name and retrying when a sequence number is taken. */
export class FileWriter {
  constructor(
    private readonly repository: WriterRepository,
    private readonly clock: Clock,
  ) {}

  /** Inserts a new record. Returns `duplicate_content` when the client already holds this content. */
  async insert(file: FileRecord): Promise<{ result: Exclude<FileWriteResult, "name_taken" | "stale">; file: FileRecord }> {
    for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt += 1) {
      const named = { ...file, displayName: await this.nextName(file) };
      const result = await this.repository.files.insert(named);
      if (result === "ok" || result === "duplicate_content") {
        return { result, file: named };
      }
    }
    throw conflict("display_name");
  }

  /**
   * Updates a record with optimistic locking. With `rename`, a new display name is generated
   * (the client or type changed). Throws `conflict` for a stale version or duplicate content.
   */
  async update(file: FileRecord, expectedVersion: number, rename = false): Promise<FileRecord> {
    for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt += 1) {
      const next: FileRecord = {
        ...file,
        displayName: rename ? await this.nextName(file) : file.displayName,
        version: expectedVersion + 1,
      };
      const result = await this.repository.files.update(next, expectedVersion);
      if (result === "ok") {
        return next;
      }
      if (result === "stale" || result === "duplicate_content") {
        throw conflict(result);
      }
    }
    throw conflict("display_name");
  }

  private async nextName(file: FileRecord): Promise<string> {
    const setting = await this.repository.settings.get();
    const receivedOn = localDateOf(file.receivedAt, setting.timezone);
    return buildDisplayName({
      clientCode: file.clientId === null ? null : await this.clientCode(file.clientId),
      shortCode: file.docTypeId === null ? null : await this.shortCode(file.docTypeId),
      receivedOn,
      sequence: await this.repository.files.nextDisplaySequence(file.clientId, receivedOn),
    });
  }

  private async clientCode(clientId: string): Promise<string> {
    const client = await this.repository.clients.findById(clientId);
    if (client === null) {
      throw notFound("client");
    }
    return client.code;
  }

  private async shortCode(docTypeId: string): Promise<string> {
    const docType = await this.repository.docTypes.findById(docTypeId);
    if (docType === null) {
      throw notFound("doc_type");
    }
    return docType.shortCode;
  }

  now(): Date {
    return this.clock.now();
  }
}
