import { access, chmod, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createGzip } from "node:zlib";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";

async function pruneBackupDirectories(backupRoot: string) {
  const entries = (await readdir(backupRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const obsolete of entries.slice(30)) await rm(join(backupRoot, obsolete), { recursive: true, force: true });
}

export async function makeDailyBackup(day: string) {
  const databaseUrl = process.env.DATABASE_URL;
  const encryptionKey = process.env.APP_ENCRYPTION_KEY;
  if (!databaseUrl || !encryptionKey) throw new Error("Database URL and encryption key are required for backup.");
  const backupRoot = process.env.BACKUP_DIR ?? "/app/data/backups";
  const directory = join(backupRoot, day);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);

  const dumpPath = join(directory, "database.sql.gz");
  const keyPath = join(directory, "app-encryption-key.txt");
  const environmentPath = join(directory, "environment.json");
  try {
    await Promise.all([access(dumpPath), access(keyPath), access(environmentPath)]);
    await pruneBackupDirectories(backupRoot);
    return;
  } catch {
    // Incomplete backup folders are rebuilt on the next worker loop.
  }
  const dump = spawn("pg_dump", [databaseUrl, "--no-owner", "--no-privileges"], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  dump.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-4000); });
  const exit = new Promise<void>((resolve, reject) => {
    dump.once("error", reject);
    dump.once("close", (code) => code === 0 ? resolve() : reject(new Error(`pg_dump exited ${code}: ${stderr.trim()}`)));
  });
  await pipeline(dump.stdout, createGzip({ level: 9 }), createWriteStream(dumpPath, { mode: 0o600 }));
  await exit;
  await chmod(dumpPath, 0o600);

  await writeFile(keyPath, `${encryptionKey}\n`, { mode: 0o600 });
  const environment = {
    POSTGRES_DB: process.env.POSTGRES_DB,
    POSTGRES_USER: process.env.POSTGRES_USER,
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
    APP_ENCRYPTION_KEY: encryptionKey,
    APP_TIMEZONE: process.env.APP_TIMEZONE ?? "Europe/Moscow",
    SYNC_INTERVAL_HOURS: process.env.SYNC_INTERVAL_HOURS ?? "24",
    APP_PORT: process.env.APP_PORT ?? "3000",
  };
  if (!environment.POSTGRES_DB || !environment.POSTGRES_USER || !environment.POSTGRES_PASSWORD) {
    throw new Error("Database connection settings are required for a portable backup.");
  }
  const temporaryEnvironmentPath = `${environmentPath}.tmp`;
  await writeFile(temporaryEnvironmentPath, `${JSON.stringify(environment, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryEnvironmentPath, environmentPath);
  await chmod(keyPath, 0o600);
  await chmod(environmentPath, 0o600);
  await pruneBackupDirectories(backupRoot);
}
