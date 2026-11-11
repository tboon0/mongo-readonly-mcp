import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "mongo-readonly-package-"));
const staleFile = join(root, "dist", "package-smoke-stale.js");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
function run(command, args, cwd = root) {
  return execFileSync(command, args, { cwd, encoding: "utf8", timeout: 120_000 });
}

try {
  // Packing must rebuild, not ship artifacts left by a previous version.
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(staleFile, "throw new Error('stale build');\n");
  const output = run(npm, ["pack", "--json", "--pack-destination", temporary]);
  const [pack] = JSON.parse(output.slice(output.indexOf("[")));
  const files = pack.files.map(({ path }) => path);
  assert(files.includes("dist/index.js"));
  assert(files.includes("README.md"));
  assert(files.includes("LICENSE"));
  assert(!files.some(file => /(^|\/)(profiles\.yaml|\.env(?:\..*)?|\.npmrc)$/.test(file)), "Private configuration packaged");
  assert(files.includes("profiles.yaml.example"));
  assert(!files.includes("dist/package-smoke-stale.js"));
  for (const file of files) {
    assert(!/^(src|test|scripts|node_modules|\.github)\//.test(file), `Unexpected package file: ${file}`);
    assert(!/^dist\/core\/(write|audit|diff|guardrails|retention|snapshot)\./.test(file), `Removed module packaged: ${file}`);
  }

  const consumer = join(temporary, "consumer");
  await mkdir(consumer);
  await writeFile(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  run(npm, ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", join(temporary, pack.filename)], consumer);
  const entry = join(consumer, "node_modules", "mongo-readonly-mcp", "dist", "index.js");
  assert((await readFile(entry, "utf8")).startsWith("#!/usr/bin/env node"));
  const help = run(process.execPath, [entry, "--help"], consumer);
  assert.match(help, /mongo-readonly-mcp/);
  assert.match(help, /find-one/);
  assert.match(help, /serve/);

  // Exercise the installed production dependencies and stdio protocol without MongoDB.
  const require = createRequire(entry);
  const { Client } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js")));
  const { StdioClientTransport } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/stdio.js")));
  const client = new Client({ name: "package-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry, "serve"], cwd: consumer });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert(tools.some(({ name }) => name === "mongo_find"));
    assert(tools.every(({ annotations }) => annotations?.readOnlyHint === true));
  } finally {
    await client.close();
  }
  console.log(`Package smoke passed: ${pack.filename} (${files.length} files)`);
} finally {
  await rm(staleFile, { force: true });
  await rm(temporary, { recursive: true, force: true });
}
