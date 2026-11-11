import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isIP } from "node:net";
import { resolve } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { Config, Profile } from "./types.js";

const profileInputSchema = z.object({
  host: z.string(),
  port: z.number().int().positive(),
  db: z.string().min(1),
  username: z.string().optional(),
  password: z.string().optional(),
  auth_db: z.string().optional(),
  authSource: z.string().optional(),
  tls: z.boolean().optional(),
  tlsCAFile: z.string().min(1).optional(),
});

const profileSchema = profileInputSchema.extend({
  host: profileInputSchema.shape.host.default("localhost"),
  port: profileInputSchema.shape.port.default(27017),
});

const fileSchema = z.object({
  defaults: profileInputSchema.partial().optional().default({}),
  profiles: z.record(z.string(), profileInputSchema.partial().extend({ db: z.string().min(1) })),
});

export function usesTls(profile: Pick<Profile, "host" | "tls" | "tlsCAFile">): boolean {
  const host = profile.host.replace(/^\[|\]$/g, "").toLowerCase();
  const loopback = host === "localhost" || host === "::1" || (isIP(host) === 4 && host.startsWith("127."));
  const tls = profile.tls ?? !loopback;
  if (profile.tlsCAFile && !tls) throw new Error("tlsCAFile requires TLS to be enabled");
  return tls;
}

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return path;
}

export function findConfigPath(): string {
  const candidates = [
    process.env.MONGO_READONLY_PROFILES,
    resolve(process.cwd(), "profiles.yaml"),
    resolve(homedir(), ".mongo-readonly", "profiles.yaml"),
  ].filter((path): path is string => Boolean(path));

  const found = candidates.find((path) => existsSync(expandHome(path)));
  if (!found) {
    throw new Error(
      `profiles.yaml not found. Set MONGO_READONLY_PROFILES or create ./profiles.yaml or ~/.mongo-readonly/profiles.yaml`,
    );
  }
  return expandHome(found);
}

export function loadConfig(configPath = findConfigPath()): Config {
  const raw = YAML.parse(readFileSync(configPath, "utf8"));
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`invalid profiles.yaml: ${parsed.error.issues.map((issue) => issue.message).join(", ")}`);
  }

  const defaults = parsed.data.defaults;
  const profiles: Record<string, Profile> = {};
  for (const [name, profileInput] of Object.entries(parsed.data.profiles)) {
    const profile = { name, ...profileSchema.parse({ ...defaults, ...profileInput }) };
    usesTls(profile);
    profiles[name] = profile;
  }

  return { defaults, profiles };
}

export function getProfile(name: string, config = loadConfig()): Profile {
  const profile = config.profiles[name];
  if (!profile) throw new Error(`unknown profile '${name}'. Run 'mongo-readonly-mcp profiles' to list profiles.`);
  return profile;
}

export function listProfiles(config = loadConfig()): Array<{ name: string; host: string; port: number; db: string }> {
  return Object.values(config.profiles).map((profile) => ({
    name: profile.name,
    host: profile.host,
    port: profile.port,
    db: profile.db,
  }));
}
