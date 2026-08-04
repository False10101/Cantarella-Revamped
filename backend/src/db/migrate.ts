import { migrate } from "drizzle-orm/node-postgres/migrator";

import { database, databasePool } from "./client.js";

try {
  await migrate(database, { migrationsFolder: "./drizzle" });
} finally {
  await databasePool.end();
}
