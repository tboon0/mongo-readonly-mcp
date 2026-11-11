import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listProfiles } from "../core/config.js";
import { maskError, toJson } from "../core/json.js";
import { find, findOne, count, aggregate, distinct, listCollections, collStats, parseDocument, MAX_LIMIT } from "../core/read.js";

const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
const profileArg = { profile: z.string().min(1) };
const collectionArg = { collection: z.string().min(1) };
const limitArg = { limit: z.number().int().min(1).max(MAX_LIMIT).optional() };
const queryArgs = {
  ...profileArg,
  ...collectionArg,
  query: z.unknown().optional().default({}),
  sort: z.unknown().optional(),
  projection: z.unknown().optional(),
};

function jsonContent(value: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: toJson(value) }], isError };
}

async function tool(handler: () => Promise<unknown>) {
  try {
    return jsonContent(await handler());
  } catch (error) {
    return jsonContent({ error: maskError(error) }, true);
  }
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "mongo-readonly-mcp", version: "0.1.0" });

  server.registerTool("mongo_list_profiles", {
    description: "List named MongoDB connections with host, port, and database; no credentials.",
    inputSchema: {}, annotations,
  }, async () => tool(async () => listProfiles()));
  server.registerTool("mongo_find", {
    description: "Read documents from a profile. Default limit 100, maximum 1000.",
    inputSchema: { ...queryArgs, ...limitArg, skip: z.number().int().nonnegative().optional() }, annotations,
  }, async (args) => tool(async () => find(args.profile, args.collection, args.query, {
    limit: args.limit,
    skip: args.skip,
    sort: args.sort ? parseDocument(args.sort) : undefined,
    projection: args.projection ? parseDocument(args.projection) : undefined,
  })));
  server.registerTool("mongo_find_one", {
    description: "Read one matching document from a profile.",
    inputSchema: queryArgs, annotations,
  }, async (args) => tool(async () => findOne(args.profile, args.collection, args.query, {
    sort: args.sort ? parseDocument(args.sort) : undefined,
    projection: args.projection ? parseDocument(args.projection) : undefined,
  })));
  server.registerTool("mongo_count", {
    description: "Count matching documents in a profile's collection.",
    inputSchema: { ...profileArg, ...collectionArg, query: z.unknown().optional().default({}) }, annotations,
  }, async (args) => tool(async () => count(args.profile, args.collection, args.query)));
  server.registerTool("mongo_aggregate", {
    description: "Run a read-only aggregation; $out and $merge are forbidden. Default result limit 100, maximum 1000.",
    inputSchema: { ...profileArg, ...collectionArg, ...limitArg, pipeline: z.unknown().default([]) }, annotations,
  }, async (args) => tool(async () => aggregate(args.profile, args.collection, args.pipeline, { limit: args.limit })));
  server.registerTool("mongo_distinct", {
    description: "Read distinct field values in a profile's collection.",
    inputSchema: { ...profileArg, ...collectionArg, field: z.string().min(1), query: z.unknown().optional().default({}) }, annotations,
  }, async (args) => tool(async () => distinct(args.profile, args.collection, args.field, args.query)));
  server.registerTool("mongo_list_collections", {
    description: "List collection names in a profile's database.",
    inputSchema: profileArg, annotations,
  }, async (args) => tool(async () => listCollections(args.profile)));
  server.registerTool("mongo_collection_stats", {
    description: "Read collection statistics from a profile.",
    inputSchema: { ...profileArg, ...collectionArg }, annotations,
  }, async (args) => tool(async () => collStats(args.profile, args.collection)));

  return server;
}

export async function startServer(): Promise<void> {
  await createServer().connect(new StdioServerTransport());
}
