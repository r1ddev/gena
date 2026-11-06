import { bootstrapFirstOwner } from "@/security/auth";
import { pool } from "./index";

try {
  const login = process.argv[2]?.trim();
  if (!login) throw new Error("Укажи логин владельца.");
  const credentials = await bootstrapFirstOwner(login);
  process.stdout.write(`${JSON.stringify(credentials)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
