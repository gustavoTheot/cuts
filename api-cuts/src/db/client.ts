import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

function createClient() {
  // Ensure the directory for the SQLite file exists
  const dir = dirname(env.DATABASE_URL);
  if (dir && dir !== ".") {
    mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(env.DATABASE_URL);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  migrate(db, { migrationsFolder: new URL("./migrations", import.meta.url).pathname });

  return db;
}

export const db = createClient();
export type Db = typeof db;
