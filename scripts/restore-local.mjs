import { createInterface } from "node:readline/promises";
import { access, chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const date = process.argv[2] ?? "";
const parsedDate = new Date(`${date}T00:00:00.000Z`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
  process.stderr.write("Укажите дату резервной копии в формате YYYY-MM-DD.\nПример: npm run restore:local -- 2026-10-20\n");
  process.exit(2);
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options });
    child.once("error", rejectRun);
    child.once("close", (code) => code === 0 ? resolveRun() : rejectRun(new Error(`${command} exited with status ${code}`)));
  });
}

function validateEnvironment(environment) {
  const requiredNames = ["POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD", "APP_ENCRYPTION_KEY", "APP_TIMEZONE", "SYNC_INTERVAL_HOURS", "APP_PORT"];
  for (const name of requiredNames) {
    if (typeof environment[name] !== "string" || /[\r\n]/.test(environment[name])) throw new Error(`Некорректная настройка ${name} в резервной копии.`);
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(environment.POSTGRES_DB) || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(environment.POSTGRES_USER)) {
    throw new Error("Имя базы или пользователя в резервной копии содержит недопустимые символы.");
  }
  if (!/^[a-f\d]{64}$/i.test(environment.APP_ENCRYPTION_KEY)) throw new Error("Ключ шифрования в резервной копии некорректен.");
  if (!/^[a-zA-Z0-9_-]{16,256}$/.test(environment.POSTGRES_PASSWORD)) throw new Error("Пароль базы в резервной копии имеет неподдерживаемый формат.");
  if (!/^\d+$/.test(environment.APP_PORT) || Number(environment.APP_PORT) < 1 || Number(environment.APP_PORT) > 65_535) throw new Error("Порт приложения в резервной копии некорректен.");
  if (!/^\d+$/.test(environment.SYNC_INTERVAL_HOURS) || Number(environment.SYNC_INTERVAL_HOURS) < 1 || Number(environment.SYNC_INTERVAL_HOURS) > 168) throw new Error("Интервал синхронизации в резервной копии некорректен.");
  try { new Intl.DateTimeFormat("en-US", { timeZone: environment.APP_TIMEZONE }); }
  catch { throw new Error("Часовой пояс в резервной копии некорректен."); }
}

const backupDirectory = resolve(root, "data/backups", date);
const dumpPath = join(backupDirectory, "database.sql.gz");
const keyPath = join(backupDirectory, "app-encryption-key.txt");
const environmentPath = join(backupDirectory, "environment.json");
const environment = JSON.parse(await readFile(environmentPath, "utf8"));
validateEnvironment(environment);
const backupKey = (await readFile(keyPath, "utf8")).trim();
if (backupKey !== environment.APP_ENCRYPTION_KEY) throw new Error("Ключ в резервной копии не совпадает с параметрами подключения.");
await access(dumpPath);
await run("gunzip", ["-t", dumpPath]);

const readline = createInterface({ input: process.stdin, output: process.stdout });
const answer = await readline.question(`ВНИМАНИЕ: текущая база будет заменена копией ${date}. Введите RESTORE ${date} для подтверждения: `);
readline.close();
if (answer.trim() !== `RESTORE ${date}`) {
  process.stdout.write("Восстановление отменено.\n");
  process.exit(1);
}

const postgresDirectory = join(root, "data/postgres");
const archiveId = new Date().toISOString().replace(/[:.]/g, "-");
const archiveDirectory = join(root, "data/restore-archives", archiveId);
const archivedPostgresDirectory = join(archiveDirectory, "postgres");
const failedPostgresDirectory = join(archiveDirectory, "failed-postgres");
const envPath = join(root, ".env");
let previousEnv = null;
let movedDatabase = false;
let replacedEnvironment = false;
let createdDatabaseDirectory = false;

async function writeEnvironmentFile(path, values) {
  const body = `${Object.entries(values).map(([name, value]) => `${name}=${value}`).join("\n")}\n`;
  const temporaryPath = `${path}.restore.tmp`;
  await writeFile(temporaryPath, body, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
}

async function waitForDatabase() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await new Promise((resolveRun) => {
      const child = spawn("docker", ["compose", "exec", "-T", "db", "pg_isready", "-U", environment.POSTGRES_USER, "-d", environment.POSTGRES_DB], { cwd: root, stdio: "ignore" });
      child.once("error", () => resolveRun(false));
      child.once("close", (code) => resolveRun(code === 0));
    });
    if (result) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error("PostgreSQL не запустился за 60 секунд.");
}

async function restoreDump() {
  const gunzip = spawn("gunzip", ["-c", dumpPath], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
  const psql = spawn("docker", ["compose", "exec", "-T", "db", "sh", "-lc", 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'], {
    cwd: root,
    stdio: ["pipe", "inherit", "inherit"],
  });
  gunzip.stdout.pipe(psql.stdin);
  await Promise.all([gunzip, psql].map((child) => new Promise((resolveRun, rejectRun) => {
    child.once("error", rejectRun);
    child.once("close", (code) => code === 0 ? resolveRun() : rejectRun(new Error(`${child.spawnfile} exited with status ${code}`)));
  })));
}

try {
  await mkdir(archiveDirectory, { recursive: true, mode: 0o700 });
  try {
    previousEnv = await readFile(envPath, "utf8");
    await writeFile(join(archiveDirectory, ".env"), previousEnv, { mode: 0o600 });
    await chmod(join(archiveDirectory, ".env"), 0o600);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  await run("docker", ["compose", "stop", "web", "worker", "db"]);
  try {
    await access(postgresDirectory);
    await rename(postgresDirectory, archivedPostgresDirectory);
    movedDatabase = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(postgresDirectory, { recursive: true, mode: 0o700 });
  createdDatabaseDirectory = true;
  await writeEnvironmentFile(envPath, environment);
  replacedEnvironment = true;

  await run("docker", ["compose", "up", "-d", "db"]);
  await waitForDatabase();
  await restoreDump();
  await run("docker", ["compose", "up", "-d", "--build"]);
  process.stdout.write(`База восстановлена из копии ${date}; веб-приложение и фоновый процесс запущены. Прежнее состояние сохранено в ${archiveDirectory}.\n`);
} catch (error) {
  try {
    await run("docker", ["compose", "stop", "web", "worker", "db"]);
    if (createdDatabaseDirectory) {
      try {
        await access(postgresDirectory);
        await rename(postgresDirectory, failedPostgresDirectory);
      } catch (moveError) {
        if (moveError?.code !== "ENOENT") throw moveError;
      }
    }
    if (movedDatabase) {
      await rename(archivedPostgresDirectory, postgresDirectory);
    }
    if (replacedEnvironment && previousEnv !== null) {
      await writeFile(envPath, previousEnv, { mode: 0o600 });
      await chmod(envPath, 0o600);
    } else if (replacedEnvironment) {
      await rm(envPath, { force: true });
    }
    await run("docker", ["compose", "up", "-d"]);
  } catch (rollbackError) {
    process.stderr.write(`Автоматический возврат к прежнему состоянию не завершился. Данные сохранены в ${archiveDirectory}. ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}\n`);
  }
  throw error;
}
