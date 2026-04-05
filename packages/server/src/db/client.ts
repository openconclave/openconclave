import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import { DB_PATH } from "../lib/workspace";

const sqlite = new Database(DB_PATH);
sqlite.exec("PRAGMA busy_timeout = 5000;"); // retry on SQLITE_BUSY for cross-run write contention
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

export const db = drizzle(sqlite, { schema });
