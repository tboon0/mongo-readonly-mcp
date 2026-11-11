import type { Document } from "mongodb";
import { getProfile } from "./config.js";
import { getDb } from "./mongo.js";
import { parseJsonParam } from "./json.js";
import type { Profile, ReadOptions } from "./types.js";

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 1000;
export const MAX_TIME_MS = 10_000;

function validateLimit(limit = DEFAULT_LIMIT): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return limit;
}

function isDocument(value: unknown): value is Document {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseDocument(input: unknown, fallback: Document = {}): Document {
  const parsed = parseJsonParam(input, fallback);
  if (!isDocument(parsed)) throw new Error("expected a JSON object");
  return parsed;
}

export function parseArray(input: unknown): Document[] {
  const parsed = parseJsonParam(input, []);
  if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
  return parsed as Document[];
}

function assertReadOnlyPipeline(pipeline: Document[]): void {
  for (const stage of pipeline) {
    if (!isDocument(stage)) throw new Error("aggregate pipeline stages must be JSON objects");
    if (Object.hasOwn(stage, "$out") || Object.hasOwn(stage, "$merge")) {
      throw new Error("aggregate pipelines with $out or $merge are not allowed");
    }
    if (Object.keys(stage).length !== 1) throw new Error("aggregate stages must have exactly one operator");
    if (isDocument(stage.$lookup) && Array.isArray(stage.$lookup.pipeline)) {
      assertReadOnlyPipeline(stage.$lookup.pipeline);
    }
    if (isDocument(stage.$unionWith) && Array.isArray(stage.$unionWith.pipeline)) {
      assertReadOnlyPipeline(stage.$unionWith.pipeline);
    }
    if (isDocument(stage.$facet)) {
      for (const branch of Object.values(stage.$facet)) {
        if (!Array.isArray(branch)) throw new Error("$facet branches must be pipelines");
        assertReadOnlyPipeline(branch);
      }
    }
  }
}

function resolveProfile(profile: string | Profile): Profile {
  return typeof profile === "string" ? getProfile(profile) : profile;
}

export async function find(profileInput: string | Profile, collection: string, filterInput: unknown, options: ReadOptions = {}) {
  const limit = validateLimit(options.limit);
  const skip = options.skip ?? 0;
  if (!Number.isSafeInteger(skip) || skip < 0) throw new Error("skip must be a nonnegative integer");
  const filter = parseDocument(filterInput);
  const db = await getDb(resolveProfile(profileInput));
  return db
    .collection(collection)
    .find(filter, { projection: options.projection, maxTimeMS: MAX_TIME_MS })
    .sort(options.sort ?? {})
    .skip(skip)
    .limit(limit)
    .toArray();
}

export async function findOne(profileInput: string | Profile, collection: string, filterInput: unknown, options: ReadOptions = {}) {
  const profile = resolveProfile(profileInput);
  const db = await getDb(profile);
  return db.collection(collection).findOne(parseDocument(filterInput), { projection: options.projection, sort: options.sort, maxTimeMS: MAX_TIME_MS });
}

export async function count(profileInput: string | Profile, collection: string, filterInput: unknown) {
  const profile = resolveProfile(profileInput);
  const db = await getDb(profile);
  return db.collection(collection).countDocuments(parseDocument(filterInput), { maxTimeMS: MAX_TIME_MS });
}

export async function aggregate(profileInput: string | Profile, collection: string, pipelineInput: unknown, options: Pick<ReadOptions, "limit"> = {}) {
  const limit = validateLimit(options.limit);
  const pipeline = parseArray(pipelineInput);
  assertReadOnlyPipeline(pipeline);
  const db = await getDb(resolveProfile(profileInput));
  return db.collection(collection).aggregate([...pipeline, { $limit: limit }], {
    maxTimeMS: MAX_TIME_MS,
    allowDiskUse: false,
  }).toArray();
}

export async function distinct(profileInput: string | Profile, collection: string, field: string, filterInput: unknown = {}) {
  const profile = resolveProfile(profileInput);
  const db = await getDb(profile);
  return db.collection(collection).distinct(field, parseDocument(filterInput), { maxTimeMS: MAX_TIME_MS });
}

export async function listCollections(profileInput: string | Profile) {
  const profile = resolveProfile(profileInput);
  const db = await getDb(profile);
  return db.listCollections({}, { nameOnly: true, maxTimeMS: MAX_TIME_MS }).toArray();
}

export async function collStats(profileInput: string | Profile, collection: string) {
  const profile = resolveProfile(profileInput);
  const db = await getDb(profile);
  return db.command({ collStats: collection, maxTimeMS: MAX_TIME_MS });
}
