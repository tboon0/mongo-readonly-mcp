import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "../src/core/types.js";

const mocks = vi.hoisted(() => ({ clients: [] as Array<{ connect: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }>, constructor: vi.fn() }));
vi.mock("mongodb", () => ({
  MongoClient: class {
    connect = vi.fn(async () => this);
    close = vi.fn(async () => undefined);
    constructor(uri: string, options: unknown) {
      mocks.constructor(uri, options);
      mocks.clients.push(this);
    }
  },
}));

import { closeClients, getClient } from "../src/core/mongo.js";

const profile: Profile = { name: "test", host: "db.example.test", port: 27017, db: "data", username: "reader", password: "test-password" };

beforeEach(() => { mocks.constructor.mockClear(); mocks.clients.length = 0; });
afterEach(closeClients);

describe("MongoDB connection security", () => {
  it("defaults remote connections to verified TLS", async () => {
    await getClient(profile);
    expect(mocks.constructor).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      tls: true, tlsAllowInvalidCertificates: false, tlsAllowInvalidHostnames: false,
    }));
  });

  it.each(["localhost", "127.0.0.1", "127.0.0.2", "::1", "[::1]"])("preserves plaintext loopback connections for %s", async host => {
    await getClient({ ...profile, host });
    expect(mocks.constructor).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ tls: false }));
  });

  it("supports explicit TLS and private CAs without disabling verification", async () => {
    await getClient({ ...profile, host: "localhost", tls: true, tlsCAFile: "/tmp/test-ca.pem" });
    expect(mocks.constructor).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      tls: true, tlsCAFile: "/tmp/test-ca.pem", tlsAllowInvalidCertificates: false, tlsAllowInvalidHostnames: false,
    }));
  });

  it("allows explicit plaintext but rejects a CA on plaintext connections", async () => {
    await getClient({ ...profile, tls: false });
    expect(mocks.constructor).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ tls: false }));
    await expect(getClient({ ...profile, tls: false, tlsCAFile: "/tmp/test-ca.pem" })).rejects.toThrow("requires TLS");
  });

  it("reuses only clients with identical effective credentials and connection settings", async () => {
    const original = await getClient(profile);
    expect(await getClient({ ...profile })).toBe(original);
    for (const change of [
      { username: "other-reader" }, { password: "rotated-test-password" }, { authSource: "admin" },
      { tls: false }, { tlsCAFile: "/tmp/other-ca.pem" },
    ]) {
      expect(await getClient({ ...profile, ...change })).not.toBe(original);
    }
    expect(mocks.constructor).toHaveBeenCalledTimes(6);
  });
});
