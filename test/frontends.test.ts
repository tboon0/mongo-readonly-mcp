import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { withMongo, withTempDir } from "./helpers.js";

const exec = promisify(execFile);
const entry = resolve("dist/index.js");
const readTools = ["mongo_list_profiles", "mongo_find", "mongo_find_one", "mongo_count", "mongo_aggregate", "mongo_distinct", "mongo_list_collections", "mongo_collection_stats"];

describe("read-only frontends", () => {
  it("exposes only annotated read tools over stdio, rejects writes, and leaves old artifacts alone", async () => {
    await withTempDir(async dir => {
      const snapshots = join(dir, "snapshots", "20000101T000000-old");
      await mkdir(snapshots, { recursive: true });
      const artifact = join(snapshots, "before.json");
      await writeFile(artifact, "[]");
      const configPath = join(dir, "profiles.yaml");
      await writeFile(configPath, JSON.stringify({ profiles: { test: { db: "test", allowWrite: true, dataDir: dir, retentionDays: 1 } } }));
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [entry, "serve"],
        cwd: dir,
        env: { MONGO_READONLY_PROFILES: configPath },
      });
      const client = new Client({ name: "test", version: "1" });
      try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        expect(tools.map(t => t.name).sort()).toEqual([...readTools].sort());
        for (const tool of tools) expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
        const profiles = await client.callTool({ name: "mongo_list_profiles", arguments: {} });
        expect(profiles.isError).toBe(false);
        expect(JSON.stringify(profiles)).not.toContain("allowWrite");
        const blocked = await client.callTool({ name: "mongo_aggregate", arguments: { profile: "test", collection: "items", pipeline: [{ $out: "other" }] } });
        expect(blocked.isError).toBe(true);
        expect(JSON.stringify(blocked)).toContain("$out or $merge");
        const removed = await client.callTool({ name: "mongo_insert_one", arguments: { profile: "test", collection: "items", document: {} } });
        expect(removed.isError).toBe(true);
        expect(await readFile(artifact, "utf8")).toBe("[]");
      } finally {
        await client.close();
      }
    });
  });

  it("has a read-only CLI command surface", async () => {
    const { stdout } = await exec(process.execPath, [entry, "--help"]);
    for (const command of ["profiles", "collections", "stats", "find", "find-one", "count", "aggregate", "distinct"]) expect(stdout).toContain(command);
    for (const command of ["insert-one", "insert-many", "update-one", "delete-one", "audit", "snapshot", "prune"]) {
      expect(stdout).not.toContain(command);
      await expect(exec(process.execPath, [entry, command])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("unknown command") });
    }
  });

  it("validates CLI numeric options rather than accepting partial numbers", async () => {
    await expect(exec(process.execPath, [entry, "find", "--profile", "test", "-c", "items", "--limit", "1oops"])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("integer") });
    await expect(exec(process.execPath, [entry, "find", "--profile", "test", "-c", "items", "--limit", "0"])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("limit must be") });
  });

  it("reads through the CLI using a configured profile", async () => {
    await withMongo(async ({ profile, client }) => {
      await client.db(profile.db).collection("items").insertOne({ value: 42 });
      await withTempDir(async dir => {
        const configPath = join(dir, "profiles.yaml");
        await writeFile(configPath, JSON.stringify({ profiles: { test: profile } }));
        const options = { cwd: dir, env: { ...process.env, MONGO_READONLY_PROFILES: configPath } };
        const { stdout } = await exec(process.execPath, [entry, "find", "--profile", "test", "-c", "items", "--projection", '{"_id":0}'], options);
        expect(JSON.parse(stdout)).toEqual([{ value: 42 }]);
        const collections = await exec(process.execPath, [entry, "collections", "--profile", "test"], options);
        expect(JSON.parse(collections.stdout)).toEqual([{ name: "items", type: "collection" }]);
      });
    });
  });
});
