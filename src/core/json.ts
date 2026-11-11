import { Binary, ObjectId, UUID } from "mongodb";

export function parseJsonParam(input: unknown, fallback: unknown = {}): unknown {
  if (input === undefined || input === null || input === "") return fallback;
  if (typeof input !== "string") return reviveExtendedJson(input);

  const normalized = normalizeObjectIds(input);
  return reviveExtendedJson(JSON.parse(normalized));
}

function normalizeObjectIds(input: string): string {
  let out = "";
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) inString = false;
      continue;
    }

    const objectId = input.slice(index).match(/^ObjectId\(\s*["']([0-9a-fA-F]{24})["']\s*\)/);
    if (objectId) {
      out += `{"$oid":"${objectId[1]}"}`;
      index += objectId[0].length - 1;
      continue;
    }

    out += char;
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
    }
  }

  return out;
}

function reviveExtendedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => reviveExtendedJson(item));
  if (value && typeof value === "object") {
    if (value instanceof ObjectId || value instanceof Binary || value instanceof Date) return value;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (typeof record.$oid === "string" && keys.length === 1) {
      return new ObjectId(record.$oid);
    }
    if (typeof record.$uuid === "string" && keys.length === 1) return new UUID(record.$uuid);
    if (keys.length === 1 && isCanonicalBinary(record)) {
      return Binary.createFromBase64(record.$binary.base64, Number.parseInt(record.$binary.subType, 16));
    }
    if (keys.length === 2 && isLegacyBinary(record)) return Binary.createFromBase64(record.$binary, Number.parseInt(record.$type, 16));
    if ((typeof record.$date === "string" || typeof record.$date === "number") && keys.length === 1) return new Date(record.$date);

    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, reviveExtendedJson(child)]));
  }
  return value;
}

function isCanonicalBinary(record: Record<string, unknown>): record is { $binary: { base64: string; subType: string } } {
  const binary = record.$binary;
  return Boolean(
    binary &&
      typeof binary === "object" &&
      typeof (binary as Record<string, unknown>).base64 === "string" &&
      typeof (binary as Record<string, unknown>).subType === "string",
  );
}

function isLegacyBinary(record: Record<string, unknown>): record is { $binary: string; $type: string } {
  return typeof record.$binary === "string" && typeof record.$type === "string";
}

export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function maskSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => maskSecrets(item));
  if (typeof value === "string") return maskString(value);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, /password|passwd|secret|token|api[_-]?key/i.test(key) ? "***" : maskSecrets(child)]),
  );
}

export function maskError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return maskString(message);
}

function maskString(value: string): string {
  return value
    .replace(/(mongodb(?:\+srv)?:\/\/[^:\s/@]+:)([^@\s]+)(@)/gi, "$1***$3")
    .replace(/(password=)([^&\s]+)/gi, "$1***");
}
