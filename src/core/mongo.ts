import { createHash } from "node:crypto";
import { MongoClient } from "mongodb";
import { expandHome, usesTls } from "./config.js";
import type { Profile } from "./types.js";

const clients = new Map<string, Promise<MongoClient>>();

export function buildMongoUri(profile: Profile): string {
  const auth =
    profile.username && profile.password !== undefined
      ? `${encodeURIComponent(profile.username)}:${encodeURIComponent(profile.password)}@`
      : "";
  const authSource = encodeURIComponent(profile.authSource ?? profile.auth_db ?? profile.db);
  const host = profile.host.includes(":") && !profile.host.startsWith("[") ? `[${profile.host}]` : profile.host;
  return `mongodb://${auth}${host}:${profile.port}/${encodeURIComponent(
    profile.db,
  )}?authSource=${authSource}&directConnection=true`;
}

export async function getClient(profile: Profile): Promise<MongoClient> {
  const uri = buildMongoUri(profile);
  const options = {
    serverSelectionTimeoutMS: 10_000,
    tls: usesTls(profile),
    tlsAllowInvalidCertificates: false,
    tlsAllowInvalidHostnames: false,
    ...(profile.tlsCAFile ? { tlsCAFile: expandHome(profile.tlsCAFile) } : {}),
  };
  const key = createHash("sha256").update(JSON.stringify({ uri, options })).digest("hex");
  const existing = clients.get(key);
  if (existing) return existing;

  const client = new MongoClient(uri, options);
  const connecting = client.connect().catch((error) => {
    if (clients.get(key) === connecting) clients.delete(key);
    void client.close().catch(() => undefined);
    throw error;
  });
  clients.set(key, connecting);
  return connecting;
}

export async function getDb(profile: Profile) {
  const client = await getClient(profile);
  return client.db(profile.db);
}

export async function ping(profile: Profile): Promise<boolean> {
  const db = await getDb(profile);
  await db.command({ ping: 1 });
  return true;
}

export async function closeClients(): Promise<void> {
  const pending = [...clients.values()];
  clients.clear();
  const settled = await Promise.allSettled(pending);
  await Promise.all(
    settled.map((result) => (result.status === "fulfilled" ? result.value.close() : Promise.resolve())),
  );
}
