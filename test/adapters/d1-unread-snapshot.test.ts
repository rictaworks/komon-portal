import { beforeAll, describe, expect, it } from "vitest";
import { D1Repository } from "../../src/app/adapters/d1/d1-repository";
import { client, fileRecord, user } from "../support/builders";
import { migrate } from "../support/d1";

const T0 = new Date("2026-11-24T03:00:00.000Z");
const CLIENT = "snap-client";
const READER = "snap-reader";

/**
 * A database that lets another writer in right after the first statement that is executed on its
 * own. Statements sent together in one `batch` are passed through untouched, as D1 runs them as one
 * transaction.
 */
function interleaving(real: D1Database, between: () => Promise<void>): D1Database {
  const originals = new WeakMap<object, D1PreparedStatement>();
  let fired = false;
  const afterSingle = async <T>(result: T): Promise<T> => {
    if (!fired) {
      fired = true;
      await between();
    }
    return result;
  };
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = {
      bind: (...values: unknown[]) => wrap(statement.bind(...values)),
      first: async (...args: []) => afterSingle(await statement.first(...args)),
      all: async () => afterSingle(await statement.all()),
      run: async () => afterSingle(await statement.run()),
      raw: async (...args: []) => afterSingle(await statement.raw(...args)),
    } as unknown as D1PreparedStatement;
    originals.set(wrapped, statement);
    return wrapped;
  };
  return {
    prepare: (sql: string) => wrap(real.prepare(sql)),
    batch: (statements: D1PreparedStatement[]) =>
      real.batch(
        statements.map((statement) => {
          const original = originals.get(statement);
          if (original === undefined) {
            throw new Error("a statement that was not prepared on this database was sent in a batch");
          }
          return original;
        }),
      ),
  } as unknown as D1Database;
}

describe("D1 unread documents: one snapshot", () => {
  let db: D1Database;
  let seed: D1Repository;

  const publish = async (label: string, minute: number): Promise<void> => {
    const row = fileRecord({
      id: `snap-${label}`, batchId: "snap-batch", clientId: CLIENT, displayName: `SNAP_${label}`, sha256: `5${label}`.padEnd(64, "e"),
      state: "Published", receivedAt: T0, publishedAt: new Date(T0.getTime() + minute * 60_000),
    });
    expect(await seed.files.insert(row)).toBe("ok");
  };

  beforeAll(async () => {
    db = await migrate();
    seed = new D1Repository(db);
    expect(await seed.clients.insert(client({ id: CLIENT, code: "SNAP01" }))).toBe(true);
    await seed.users.insert(user({ id: READER, googleSub: "snap-sub-reader", createdAt: T0 }));
    await seed.users.insert(user({ id: "snap-uploader", googleSub: "snap-sub-uploader", createdAt: T0, officeRole: "Staff", officeStatus: "Active" }));
    await seed.files.insertBatch({ id: "snap-batch", uploadedBy: "snap-uploader", hintClientId: null, createdAt: T0 });
    for (let index = 0; index < 5; index += 1) {
      await publish(`a${String(index)}`, index);
    }
  });

  it("reads the unread list and its total together, so a publication in between cannot split them", async () => {
    let interleaved = false;
    const repository = new D1Repository(
      interleaving(db, async () => {
        interleaved = true;
        await publish("late", 60);
      }),
    );
    const view = await repository.files.unreadPublished(CLIENT, READER, { limit: 100, offset: 0 });
    expect(view.total).toBe(view.files.length);
    expect(view.files).toHaveLength(5);
    // The harness itself works: a statement executed on its own does let the other writer in.
    expect(interleaved).toBe(false);
    await repository.files.findById("snap-a0");
    expect(interleaved).toBe(true);
    expect((await repository.files.unreadPublished(CLIENT, READER, { limit: 100, offset: 0 })).total).toBe(6);
  });
});
