import { describe, expect, it } from "vitest";
import { aggregate, find, findOne, count, distinct, listCollections, collStats, MAX_LIMIT } from "../src/core/read.js";
import { withMongo } from "./helpers.js";

// An unknown profile proves validation runs before any connection is attempted.
const unavailable = "not-configured";

describe("read operations", () => {
  it.each([
    [{ $out: "other" }],
    [{ $match: {} }, { $merge: "other" }],
    [{ $lookup: { from: "items", pipeline: [{ $out: "other" }], as: "joined" } }],
    [{ $unionWith: { coll: "items", pipeline: [{ $merge: "other" }] } }],
    [{ $facet: { branch: [{ $out: { db: "other", coll: "items" } }] } }],
  ])("rejects write stages before connecting: %j", async (...pipeline) => {
    await expect(aggregate(unavailable, "items", pipeline)).rejects.toThrow("$out or $merge");
  });

  it.each([0, -1, 1.5, MAX_LIMIT + 1, NaN, Infinity])("rejects unsafe limit %s", async (limit) => {
    await expect(find(unavailable, "items", {}, { limit })).rejects.toThrow("limit must be");
    await expect(aggregate(unavailable, "items", [], { limit })).rejects.toThrow("limit must be");
  });

  it("rejects malformed pipelines and skip", async () => {
    await expect(aggregate(unavailable, "items", {})).rejects.toThrow("JSON array");
    await expect(aggregate(unavailable, "items", [null])).rejects.toThrow("JSON objects");
    await expect(aggregate(unavailable, "items", [{ $match: {}, $limit: 1 }])).rejects.toThrow("one operator");
    await expect(find(unavailable, "items", {}, { skip: -1 })).rejects.toThrow("skip must be");
  });

  it("supports all read operations without changing documents", async () => {
    await withMongo(async ({ profile, client }) => {
      const collection = client.db(profile.db).collection("items");
      await collection.insertMany([{ value: 1, category: "a" }, { value: 2, category: "a" }, { value: 3, category: "b" }]);
      const before = await collection.find().toArray();
      expect(await find(profile, "items", {}, { sort: { value: -1 }, skip: 1, limit: 1, projection: { _id: 0, value: 1 } })).toEqual([{ value: 2 }]);
      expect(await findOne(profile, "items", { value: 1 }, { projection: { _id: 0, value: 1 } })).toEqual({ value: 1 });
      expect(await count(profile, "items", { category: "a" })).toBe(2);
      expect(await distinct(profile, "items", "category")).toEqual(["a", "b"]);
      expect(await listCollections(profile)).toEqual([{ name: "items", type: "collection" }]);
      expect(await collStats(profile, "items")).toMatchObject({ count: 3 });
      expect(await aggregate(profile, "items", [{ $group: { _id: "$category", total: { $sum: 1 } } }, { $sort: { _id: 1 } }])).toEqual([{ _id: "a", total: 2 }, { _id: "b", total: 1 }]);
      expect(await collection.find().toArray()).toEqual(before);
    });
  });

  it("caps find and aggregation results", async () => {
    await withMongo(async ({ profile, client }) => {
      await client.db(profile.db).collection("items").insertMany(Array.from({ length: 105 }, (_, value) => ({ value })));
      expect(await find(profile, "items", {})).toHaveLength(100);
      expect(await aggregate(profile, "items", [])).toHaveLength(100);
      expect(await aggregate(profile, "items", [], { limit: 2 })).toHaveLength(2);
    });
  });

  it("reads independent instances on different ports concurrently", async () => {
    await withMongo(async ({ profile: first, client: firstClient }) => {
      await withMongo(async ({ profile: second, client: secondClient }) => {
        expect(first.port).not.toBe(second.port);
        await firstClient.db(first.db).collection("items").insertOne({ source: "first" });
        await secondClient.db(second.db).collection("items").insertOne({ source: "second" });
        const results = await Promise.all([first, second].map(profile => find(profile, "items", {}, { projection: { _id: 0 } })));
        expect(results).toEqual([[{ source: "first" }], [{ source: "second" }]]);
      });
    });
  });
});
