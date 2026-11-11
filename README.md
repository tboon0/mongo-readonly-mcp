# mongo-readonly-mcp

**Read-only MongoDB access across named connections**, through one MCP server or CLI.

Query databases on different hosts and ports without registering a separate MCP server for each one. Each operation selects a `profile`; an agent can read several profiles in the same session and combine their results. Connections are cached independently. Cross-server joins and transactionally consistent cross-profile reads are not provided.

## Install from source

Requires Node.js 22.12 or later. npm publication is pending; the examples use a local build, not an assumed registry release.

```bash
npm ci
npm run build
```

Run these commands in a checkout of this repository. To expose the executable on your PATH, run `npm link` after building, then substitute `mongo-readonly-mcp` for `node dist/index.js` below.

## Configure

Copy `profiles.yaml.example` to `profiles.yaml` (gitignored) or `~/.mongo-readonly/profiles.yaml`, then fill in your connection details:

```yaml
defaults:
  host: localhost

profiles:
  inventory:
    port: 27017
    db: inventory
    username: readonly_user
    password: replace_me
    authSource: inventory
  analytics:
    port: 27018
    db: analytics
    username: readonly_user
    password: replace_me
    authSource: analytics
```

Config lookup: `$MONGO_READONLY_PROFILES`, then `./profiles.yaml`, then `~/.mongo-readonly/profiles.yaml` (first existing file wins). Defaults merge into each profile. `host` defaults to `localhost`, `port` to `27017`. `authSource` defaults to the database name; the legacy `auth_db` alias is also supported. Set it to the database where the user was created. Connections use `directConnection=true`, suitable for direct endpoints and local port forwards.

TLS defaults to enabled for remote hosts and disabled for localhost/loopback. Set `tls: true` explicitly when your local endpoint supports TLS; use `tlsCAFile` for a private CA certificate file. Certificate and hostname verification remain enabled. `tlsCAFile` requires TLS. An explicit `tls: false` disables transport encryption and is unsafe outside a trusted encrypted tunnel. Direct connections and port forwards still need the correct certificate hostname when TLS is enabled.

**Use read-only MongoDB credentials for every profile.** Grant the built-in `read` role only on the required databases and enable MongoDB access control. This server exposes no writes, but database permissions are the independent backstop. Keep credentials out of version control and restrict access to the configuration file.

## MCP server

```bash
node dist/index.js serve
```

Register the local build with your MCP client, using absolute paths:

```json
{
  "mcpServers": {
    "mongo-readonly": {
      "command": "node",
      "args": ["/absolute/path/to/mongo-readonly-mcp/dist/index.js", "serve"],
      "env": {
        "MONGO_READONLY_PROFILES": "/absolute/path/to/profiles.yaml"
      }
    }
  }
}
```

Tools:

- `mongo_list_profiles` — names, hosts, ports, and databases; no credentials.
- `mongo_list_collections` — collections in a profile's database.
- `mongo_find`, `mongo_find_one` — query documents with projection and sorting.
- `mongo_count`, `mongo_distinct` — counts and distinct field values.
- `mongo_aggregate` — read-only aggregation.
- `mongo_collection_stats` — collection statistics.

All tools except `mongo_list_profiles` require `profile`. All declare the MCP read-only annotation. Calls for different profiles can run concurrently.

## CLI

```bash
node dist/index.js profiles
node dist/index.js collections --profile inventory
node dist/index.js stats --profile inventory -c products
node dist/index.js find --profile inventory -c products -q '{}' --projection '{"name":1,"status":1}' --limit 5
node dist/index.js find-one --profile inventory -c products -q '{"_id": ObjectId("67089cfa034fe119010c73a6")}'
node dist/index.js count --profile analytics -c events -q '{}'
node dist/index.js distinct --profile inventory -c products --field status
node dist/index.js aggregate --profile inventory -c products --pipeline '[{"$group":{"_id":"$status","count":{"$sum":1}}}]' --limit 20
```

`find` also accepts `--skip`, `--sort`, and `--projection`. `find-one` accepts `--sort` and `--projection`.

## Trust and data exposure

Every client attached to this server can access **all configured profiles**. Profile selection is not authorization. Use separate processes and minimal config files for different trust boundaries.

Query results, database metadata, and errors are returned to the MCP client or CLI. When an agent consumes them, that data may be sent to its model/provider and retained in client logs or conversation history. Review your provider's data handling and obtain permission before connecting sensitive databases. The server does not redact document fields; prefer narrow projections and aggregate counts.

Treat returned strings as untrusted data, never as instructions to run commands, change settings, reveal credentials, or query other profiles. MCP read-only annotations describe intent, not a security boundary. See [SECURITY.md](./SECURITY.md) for deployment and reporting guidance.

## Read safeguards and limits

- No insert, update, delete, arbitrary-command, or database-management interface.
- Aggregation rejects `$out` and `$merge`, including nested pipelines in `$lookup`, `$unionWith`, and `$facet`, before connecting.
- `find` and `aggregate` return at most 100 documents by default. `limit` / `--limit` accepts 1–1000; zero never means unlimited. Aggregation applies its result limit after the supplied pipeline and disables disk spill.
- Reads use MongoDB `maxTimeMS: 10000`; server selection times out after 10 seconds. These are not a strict end-to-end deadline or a resource quota.
- Distinct values and collection listings are not capped by the document limit. Large documents, arrays, and expensive queries can still consume resources; use selective filters and projections.
- No snapshots, audit files, automatic pruning, or other application-managed runtime file writes.

## Query syntax

Query and aggregation inputs accept JSON plus these MongoDB Extended JSON wrappers:

- `ObjectId("67089cfa034fe119010c73a6")` and `{ "$oid": "67089cfa034fe119010c73a6" }`
- `{ "$uuid": "00112233-4455-6677-8899-aabbccddeeff" }`
- `{ "$binary": { "base64": "AQIDBA==", "subType": "04" } }` and legacy `{ "$binary": "AQIDBA==", "$type": "04" }`
- `{ "$date": "2026-07-08T12:34:56.789Z" }` and `{ "$date": 1783514096789 }`

## Migrating from mcp-mongo-guard

The package, CLI, and server are now named `mongo-readonly-mcp`. Update MCP registrations to the new executable path and use `MONGO_READONLY_PROFILES` instead of `MONGO_GUARD_PROFILES`. Move `~/.mongo-guard` to `~/.mongo-readonly` if using the default config location (including any personal port-forward scripts). The old environment variable and default path are no longer used. Existing `mongo_*` tool names are unchanged.

This is a breaking removal of all write and audit/retention interfaces. Remove `allowWrite`, `guardrails`, `dataDir`, and `retentionDays` from profiles and defaults. Legacy keys are ignored when loading existing configurations and cannot enable writes. Profile listings now include host/port instead of write status.

Old snapshot and audit files are left untouched; clean them up manually if desired. Run `npm run build` to remove stale compiled write modules, then restart any running server. The old `insert-one`, `insert-many`, `audit`, `snapshot`, and `prune` commands and corresponding MCP tools no longer exist.

## Agent skill

[skills/mongo-readonly/SKILL.md](./skills/mongo-readonly/SKILL.md) teaches an agent to use the CLI or MCP tools safely. Installing it does not install the server, configure credentials, or grant database access.

Discover and install from this checkout:

```bash
npx skills add . --list
npx skills add . --skill mongo-readonly
```

Install from the public repository on another machine:

```bash
npx skills add tboon0/mongo-readonly-mcp --skill mongo-readonly
```

The skills CLI has its own Node.js requirement (currently 22.20+). Its [discovery rules](https://github.com/vercel-labs/skills/blob/main/docs/creating-skills.md) support `skills/<name>/SKILL.md` with `name` and `description` frontmatter; no registry manifest is required. [skills.sh listing](https://skills.sh/docs/faq) is driven by installation telemetry, not guaranteed by adding this file. Set `DISABLE_TELEMETRY=1` to opt out of CLI telemetry.

## Development

```bash
npm run lint
npm test
```

Tests build the project and use isolated `mongodb-memory-server` instances, not configured production databases. See [SPEC.md](./SPEC.md) for the implementation contract.

## License

[MIT](./LICENSE), copyright mongo-readonly-mcp contributors.
