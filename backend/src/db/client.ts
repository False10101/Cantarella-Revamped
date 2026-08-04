import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { getEnvironment } from "../config/env.js";
import * as schema from "./schema.js";

const environment = getEnvironment();

export const databasePool = new Pool({
  connectionString: environment.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: "cantarella-backend",
});

export const database = drizzle(databasePool, { schema });
