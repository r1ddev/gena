import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");
await mkdir(resolve(root, "data/postgres"), { recursive: true });
await mkdir(resolve(root, "data/backups"), { recursive: true });

let localEnv = "";
try {
  localEnv = await readFile(envPath, "utf8");
} catch {
  const lines = [
    "POSTGRES_DB=gena",
    "POSTGRES_USER=gena",
    `POSTGRES_PASSWORD=${randomBytes(32).toString("hex")}`,
    "APP_TIMEZONE=Europe/Moscow",
    "SYNC_INTERVAL_HOURS=24",
    `APP_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`,
  ];
  localEnv = `${lines.join("\n")}\n`;
  await writeFile(envPath, localEnv, { mode: 0o600, flag: "wx" });
  await chmod(envPath, 0o600);
}

const processHandle = spawn("docker", ["compose", "up", "-d", "--build"], { cwd: root, stdio: "inherit" });
processHandle.once("error", (error) => {
  process.stderr.write(`Could not start Docker Compose: ${error.message}\n`);
  process.exitCode = 1;
});
processHandle.once("close", (code) => {
  process.exitCode = code ?? 1;
  if (code === 0) {
    const port = process.env.APP_PORT || localEnv.match(/^APP_PORT=(\d+)$/m)?.[1] || "3000";
    process.stdout.write(`Gena is starting. Open http://localhost:${port} after the containers become healthy.\n`);
  }
});
