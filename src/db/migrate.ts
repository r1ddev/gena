import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index";

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  process.stdout.write("Database migrations applied.\n");
} catch (error) {
  process.stderr.write(`Database migration failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
