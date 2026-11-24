import type { Id } from "../model/types";

export interface Notifier {
  /** Tells the client's members that a new document exists. Carries no document name or type. */
  notifyNewDocument(clientId: Id): Promise<void>;
}
