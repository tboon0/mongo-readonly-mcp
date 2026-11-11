import { describe, expect, it } from "vitest";
import { BSON, Binary, ObjectId, UUID } from "mongodb";
import { maskSecrets, parseJsonParam } from "../src/core/json.js";

describe("ObjectId parsing", () => {
  it("parses ObjectId syntax inside query JSON", () => {
    const parsed = parseJsonParam('{"_id": ObjectId("67089cfa034fe119010c73a6"), "nested": {"owner": ObjectId("67089cfa034fe119010c73a7")}}') as {
      _id: unknown;
      nested: { owner: unknown };
    };

    expect(parsed._id).toBeInstanceOf(ObjectId);
    expect(String(parsed._id)).toBe("67089cfa034fe119010c73a6");
    expect(parsed.nested.owner).toBeInstanceOf(ObjectId);
  });

  it("does not rewrite ObjectId text inside strings", () => {
    const parsed = parseJsonParam('{"note":"ObjectId(\\"67089cfa034fe119010c73a6\\")"}') as { note: string };

    expect(parsed.note).toBe('ObjectId("67089cfa034fe119010c73a6")');
  });

  it("parses Extended JSON ObjectId wrappers", () => {
    const parsed = parseJsonParam('{"_id":{"$oid":"67089cfa034fe119010c73a6"}}') as { _id: unknown };

    expect(parsed._id).toBeInstanceOf(ObjectId);
    expect(String(parsed._id)).toBe("67089cfa034fe119010c73a6");
  });

  it("parses Extended JSON UUID wrappers", () => {
    const parsed = parseJsonParam('{"tenantId":{"$uuid":"00112233-4455-6677-8899-aabbccddeeff"}}') as { tenantId: unknown };

    expect(parsed.tenantId).toBeInstanceOf(UUID);
    expect((parsed.tenantId as UUID).toHexString()).toBe("00112233-4455-6677-8899-aabbccddeeff");
    expect((parsed.tenantId as UUID).sub_type).toBe(Binary.SUBTYPE_UUID);
  });

  it("parses canonical Extended JSON Binary wrappers", () => {
    const parsed = parseJsonParam('{"key":{"$binary":{"base64":"AQIDBA==","subType":"04"}}}') as { key: unknown };

    expect(parsed.key).toBeInstanceOf(Binary);
    expect((parsed.key as Binary).toString("base64")).toBe("AQIDBA==");
    expect((parsed.key as Binary).sub_type).toBe(Binary.SUBTYPE_UUID);
  });

  it("parses legacy Extended JSON Binary wrappers", () => {
    const parsed = parseJsonParam('{"key":{"$binary":"AQIDBA==","$type":"04"}}') as { key: unknown };

    expect(parsed.key).toBeInstanceOf(Binary);
    expect((parsed.key as Binary).toString("base64")).toBe("AQIDBA==");
    expect((parsed.key as Binary).sub_type).toBe(Binary.SUBTYPE_UUID);
  });

  it("parses Extended JSON Date wrappers", () => {
    const parsed = parseJsonParam('{"createdAt":{"$date":"2026-07-08T12:34:56.789Z"},"updatedAt":{"$date":1783514096789}}') as {
      createdAt: unknown;
      updatedAt: unknown;
    };

    expect(parsed.createdAt).toBeInstanceOf(Date);
    expect((parsed.createdAt as Date).toISOString()).toBe("2026-07-08T12:34:56.789Z");
    expect(parsed.updatedAt).toBeInstanceOf(Date);
    expect((parsed.updatedAt as Date).getTime()).toBe(1783514096789);
  });

  it("does not coerce Extended JSON wrappers with extra keys", () => {
    const parsed = parseJsonParam('{"value":{"$uuid":"00112233-4455-6677-8899-aabbccddeeff","extra":true}}') as {
      value: unknown;
    };

    expect(parsed.value).toEqual({ $uuid: "00112233-4455-6677-8899-aabbccddeeff", extra: true });
  });

  it.each(['{"__proto__":{"$eq":"literal"}}', '{"__proto__":"literal"}', '{"__proto__":null}'])(
    "preserves literal __proto__ predicates through BSON serialization: %s",
    (input) => {
      const expected = JSON.parse(input);
      const parsed = parseJsonParam(input) as Record<string, unknown>;

      expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
      expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
      expect(parsed).toStrictEqual(expected);
      const decoded = BSON.deserialize(BSON.serialize(parsed));
      expect(Object.hasOwn(decoded, "__proto__")).toBe(true);
      expect(decoded).toStrictEqual(expected);
    },
  );

  it("preserves nested literal keys and ordinary object shapes", () => {
    const input = '{"items":[{"__proto__":{"$oid":"67089cfa034fe119010c73a6"},"constructor":"literal","prototype":true}],"active":true}';
    const parsed = parseJsonParam(input) as { items: Record<string, unknown>[]; active: boolean };

    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(parsed.items[0])).toBe(Object.prototype);
    expect(Object.hasOwn(parsed.items[0], "__proto__")).toBe(true);
    expect(parsed.items[0].__proto__).toEqual(new ObjectId("67089cfa034fe119010c73a6"));
    expect(parsed.items[0].constructor).toBe("literal");
    expect(parsed.items[0].prototype).toBe(true);
    expect(parsed.active).toBe(true);
  });

  it("preserves literal __proto__ keys while masking nested secrets", () => {
    const input = JSON.parse('{"__proto__":{"password":"secret"},"items":[{"__proto__":"mongodb://user:secret@example.test/db"}],"name":"plain"}');
    const masked = maskSecrets(input) as Record<string, unknown>;

    expect(Object.getPrototypeOf(masked)).toBe(Object.prototype);
    expect(Object.hasOwn(masked, "__proto__")).toBe(true);
    expect(masked).toStrictEqual(
      JSON.parse('{"__proto__":{"password":"***"},"items":[{"__proto__":"mongodb://user:***@example.test/db"}],"name":"plain"}'),
    );
    expect(input.__proto__.password).toBe("secret");
  });

  it("masks passwords embedded in logged strings", () => {
    const masked = maskSecrets({ uri: "mongodb://user:secret@example.test/db?password=secret" });

    expect(masked).toEqual({ uri: "mongodb://user:***@example.test/db?password=***" });
  });
});
