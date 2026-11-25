import { beforeAll } from "vitest";
import { D1Repository } from "../../src/app/adapters/d1/d1-repository";
import { migrate } from "../support/d1";
import { describeRepositoryContract } from "../support/repository-contract";

let db: D1Database;

beforeAll(async () => {
  db = await migrate();
});

describeRepositoryContract("d1", async () => new D1Repository(db));
