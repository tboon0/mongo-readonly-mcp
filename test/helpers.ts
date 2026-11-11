import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { closeClients } from "../src/core/mongo.js";
import type { Profile } from "../src/core/types.js";

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "mongo-readonly-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function withMongo<T>(fn: (args: { profile: Profile; client: MongoClient }) => Promise<T>): Promise<T> {
  const server = await MongoMemoryServer.create();
  const uri = server.getUri();
  const parsed = new URL(uri);
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const profile: Profile = {
      name: `test-${Math.random().toString(16).slice(2)}`,
      host: parsed.hostname,
      port: Number(parsed.port),
      db: "guardtest",
    };
    return await fn({ profile, client });
  } finally {
    await closeClients();
    await client.close();
    await server.stop();
  }
}
