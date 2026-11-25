import { describeRepositoryContract } from "../support/repository-contract";
import { MemoryRepository } from "../support/memory-repository";

describeRepositoryContract("memory", async () => new MemoryRepository());
