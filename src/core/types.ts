import type { Document } from "mongodb";

export interface Profile {
  name: string;
  host: string;
  port: number;
  db: string;
  username?: string;
  password?: string;
  auth_db?: string;
  authSource?: string;
  tls?: boolean;
  tlsCAFile?: string;
}

export interface Config {
  defaults: Partial<Omit<Profile, "name">>;
  profiles: Record<string, Profile>;
}

export interface ReadOptions {
  limit?: number;
  skip?: number;
  sort?: Document;
  projection?: Document;
}
