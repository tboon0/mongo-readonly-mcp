# mongo-readonly-mcp — Implementation Spec

## Purpose

A read-only MongoDB MCP server and CLI sharing one core. Named profiles select independent hosts, ports, databases, and credentials. One server can query multiple instances, including concurrent calls, without changing a global active connection. Combining results across servers happens in the client; no distributed joins or consistent cross-profile snapshots are promised.

## Safety contract

- No write operations, arbitrary database commands, or write-enabling flags are exposed in core, MCP, or CLI.
- Aggregation rejects `$out` and `$merge` before connecting, including nested `$lookup`, `$unionWith`, and `$facet` pipelines.
- Deploy with MongoDB access control enabled and users granted only the required `read` roles. The application does not provision users or certify their privileges.
- `find` and `aggregate` default to 100 result documents, with validated integer limits of 1–1000. Aggregation appends a final result limit without mutating the supplied pipeline and sets `allowDiskUse: false`.
- All reads use `maxTimeMS: 10000`; connections use `serverSelectionTimeoutMS: 10000`. These are not strict wall-clock deadlines or comprehensive resource bounds. Distinct values and collection names are not capped by the document limit.
- No runtime snapshots, audit files, retention pruning, or application-managed file writes. Existing artifacts remain untouched.
- Profile listings exclude credentials but reveal connection metadata. Errors mask URI passwords, not arbitrary sensitive data.
- All configured profiles are accessible to every attached client; there is no per-client authorization. Use separate processes/configs for separate trust boundaries.
- Results may reach model providers, client logs, and conversation history. Document contents are not redacted and returned text is untrusted data, not agent instructions.

## Core modules

- `types.ts`: `Profile`, `Config`, and `ReadOptions`.
- `config.ts`: Zod-validated YAML. Search `$MONGO_READONLY_PROFILES`, `./profiles.yaml`, then `~/.mongo-readonly/profiles.yaml`; use the first existing file. Merge defaults into each profile. Expand a leading `~` in config paths. Unknown keys, including obsolete write settings, are stripped.
- `mongo.ts`: URL-encoded credentials and database, `authSource` (or `auth_db`, or database), `directConnection=true`. Cache clients by a hash of the full effective URI (including credentials) and connection options (including TLS and CA settings), not by profile name. Profiles with identical effective connections share a client. Close clients after CLI calls.
- `read.ts`: `find`, `findOne`, `count`, `aggregate`, `distinct`, `listCollections`, `collStats`. Support filtering, sorting, projection, and pagination as appropriate. Validate limits in the shared core so both frontends are protected.
- `json.ts`: parse JSON, ObjectId shell syntax, ObjectId/UUID/Binary/Date wrappers, and mask errors.

Profile fields: `name` (derived from the YAML key), `host` (default localhost), `port` (default 27017), `db` (required), optional `username`, `password`, `authSource`, `auth_db`, `tls`, and `tlsCAFile`. TLS defaults on for remote hosts and off for localhost/loopback. Certificate and hostname verification remain enabled. `tlsCAFile` selects a private CA and requires TLS; explicit `tls: false` is supported but unsafe outside trusted encrypted tunnels. There are no write or runtime storage settings.

## MCP

Use `@modelcontextprotocol/sdk`, stdio transport, server name `mongo-readonly-mcp`.

Exactly these tools are exposed:

- `mongo_list_profiles`
- `mongo_list_collections`
- `mongo_find`
- `mongo_find_one`
- `mongo_count`
- `mongo_distinct`
- `mongo_aggregate`
- `mongo_collection_stats`

All except `mongo_list_profiles` require `profile`. Collection-specific tools require `collection`. All declare `readOnlyHint: true` and `destructiveHint: false`. Results are JSON text; operation errors return `isError: true` without terminating the server. `find` and `aggregate` accept optional `limit`; only `find` supports `skip`.

## CLI

Use Commander. Commands: `serve`, `profiles`, `collections`, `stats`, `find`, `find-one`, `count`, `distinct`, `aggregate`. Database reads require `--profile`; collection-specific reads also require `-c` / `--collection`. Expose appropriate query, projection, sort, pagination, field, and pipeline options. Parse numeric options strictly.

`src/index.ts` starts the MCP server when no command or `serve` is supplied, otherwise runs the CLI. Startup performs no file maintenance and requires no config until a database/profile operation is requested.

## Migration

Rename the package/CLI/server from `mcp-mongo-guard` to `mongo-readonly-mcp`, the environment variable to `MONGO_READONLY_PROFILES`, and the default config directory to `~/.mongo-readonly`. Update client registrations and executable paths. Keep `mongo_*` tool names stable.

Remove write, guardrail, snapshot, audit, diff, and retention modules and their interfaces. Legacy `allowWrite`, `guardrails`, `dataDir`, and `retentionDays` keys are ignored, not honored. Profile listings return name, host, port, and database instead of write status. Build cleans `dist` to avoid shipping obsolete compiled modules. Running old processes must be restarted.

## Verification

Required checks: `npm run lint`, `npm run build`, and `npm test`. Tests use isolated MongoDB instances and cover:

- Read operation correctness, projection, filtering, sorting, and pagination.
- Rejection of top-level and nested write stages before connecting.
- Result limits and invalid numeric options.
- Independent concurrent reads from different ports.
- Credential-safe profile listings and legacy-key removal.
- MCP tool discovery, annotations, error handling, and absent write tools.
- CLI command discovery, removed command rejection, and real reads.
- Startup leaves old snapshot artifacts untouched.
- Extended JSON parsing and password masking.
