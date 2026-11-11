import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getProfile, listProfiles, loadConfig, usesTls } from "../src/core/config.js";
import { buildMongoUri } from "../src/core/mongo.js";
import { withTempDir } from "./helpers.js";

describe("profiles", () => {
  it("merges connection defaults and strips legacy write settings and secrets from listings", async () => {
    await withTempDir(async dir => {
      const path = join(dir, "profiles.yaml");
      await writeFile(path, `
defaults:
  host: localhost
  username: reader
  password: secret
  authSource: admin
  allowWrite: true
  dataDir: /unused
  retentionDays: 1
  guardrails: {maxDocsAffected: 50}
profiles:
  first:
    port: 27017
    db: firstdb
  second:
    port: 27018
    db: seconddb
    allowWrite: true
`);
      const config = loadConfig(path);
      expect(getProfile("first", config)).toEqual({ name: "first", host: "localhost", port: 27017, db: "firstdb", username: "reader", password: "secret", authSource: "admin" });
      expect(listProfiles(config)).toEqual([
        { name: "first", host: "localhost", port: 27017, db: "firstdb" },
        { name: "second", host: "localhost", port: 27018, db: "seconddb" },
      ]);
      expect(config.defaults).not.toHaveProperty("allowWrite");
      expect(() => getProfile("missing", config)).toThrow("unknown profile");
    });
  });

  it("inherits remote host and port defaults before applying built-in defaults", async () => {
    await withTempDir(async dir => {
      const path = join(dir, "profiles.yaml");
      await writeFile(path, `
defaults:
  host: db.example.test
  port: 28018
profiles:
  inherited:
    db: data
  hostOverride:
    host: localhost
    db: data
  portOverride:
    port: 29019
    db: data
  bothOverrides:
    host: 127.0.0.1
    port: 30020
    db: data
`);
      const config = loadConfig(path);
      for (const [name, host, port, tls] of [
        ["inherited", "db.example.test", 28018, true],
        ["hostOverride", "localhost", 28018, false],
        ["portOverride", "db.example.test", 29019, true],
        ["bothOverrides", "127.0.0.1", 30020, false],
      ] as const) {
        const profile = getProfile(name, config);
        expect(profile).toMatchObject({ host, port });
        expect(usesTls(profile)).toBe(tls);
      }

      await writeFile(path, `profiles: {local: {db: data}}`);
      const localConfig = loadConfig(path);
      expect(localConfig.defaults).toEqual({});
      const local = getProfile("local", localConfig);
      expect(local).toMatchObject({ host: "localhost", port: 27017 });
      expect(usesTls(local)).toBe(false);
    });
  });

  it("merges TLS settings and rejects a CA configured without TLS", async () => {
    await withTempDir(async dir => {
      const path = join(dir, "profiles.yaml");
      await writeFile(path, `
defaults:
  tls: true
  tlsCAFile: /tmp/test-ca.pem
profiles:
  remote:
    host: db.example.test
    db: data
`);
      expect(getProfile("remote", loadConfig(path))).toMatchObject({ tls: true, tlsCAFile: "/tmp/test-ca.pem" });
      await writeFile(path, `
profiles:
  local:
    db: data
    tlsCAFile: /tmp/test-ca.pem
`);
      expect(() => loadConfig(path)).toThrow("tlsCAFile requires TLS");
      await writeFile(path, `
profiles:
  remote:
    db: data
    tls: "true"
`);
      expect(() => loadConfig(path)).toThrow("invalid profiles.yaml");
    });
  });

  it("preserves authentication source aliases and encodes credentials", () => {
    const profile = { name: "test", host: "localhost", port: 27018, db: "data", username: "a@b", password: "p:/@", auth_db: "legacy" };
    expect(buildMongoUri(profile)).toBe("mongodb://a%40b:p%3A%2F%40@localhost:27018/data?authSource=legacy&directConnection=true");
    expect(buildMongoUri({ ...profile, authSource: "admin" })).toContain("authSource=admin");
  });
});
