import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index";

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.execute(`INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  process.stdout.write("Database migrations applied.\n");
} catch (error) {
  process.stderr.write(`Database migration failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
