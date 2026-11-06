import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, users, userSessions } from "@/db/schema";

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = "gena_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
export const LEGACY_OWNER_ID = "00000000-0000-4000-8000-000000000001";
export const LEGACY_OWNER_LOGIN = "__legacy_owner__";

const buckets = new Map<string, number[]>();
function checkRateLimit(request: Request, key: string, limit: number, windowMs: number) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || "local";
  const bucketKey = `${key}:${address}`;
  const now = Date.now();
  const recent = (buckets.get(bucketKey) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) throw new Error("Слишком много попыток. Попробуйте позже.");
  recent.push(now);
  buckets.set(bucketKey, recent);
  if (buckets.size > 2000) {
    for (const [itemKey, times] of buckets) if (times.every((time) => now - time >= windowMs)) buckets.delete(itemKey);
  }
}

function validateLogin(login: unknown) {
  if (typeof login !== "string" || !/^[a-zA-Z0-9._-]{3,64}$/.test(login.trim())) {
    throw new Error("Логин: от 3 до 64 символов — латинские буквы, цифры, точка, дефис или подчёркивание.");
  }
  if (login.trim().toLowerCase() === LEGACY_OWNER_LOGIN) throw new Error("Этот логин зарезервирован.");
  return login.trim();
}

function validateCredentials(login: unknown, password: unknown) {
  const normalizedLogin = validateLogin(login);
  if (typeof password !== "string" || password.length < 10 || password.length > 128) {
    throw new Error("Пароль должен содержать от 10 до 128 символов.");
  }
  return { login: normalizedLogin, password };
}

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 32) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

async function verifyPassword(password: string, stored: string) {
  const [scheme, saltText, hashText] = stored.split("$");
  if (scheme !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  const actual = await scrypt(password, Buffer.from(saltText, "base64url"), expected.length) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function tokenDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function cookieOptions(request: Request, maxAge: number) {
  const secure = request.url.startsWith("https:") || request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(request: Request) {
  return cookieOptions(request, 0);
}

function sessionToken(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const item = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return item?.slice(SESSION_COOKIE.length + 1) || null;
}

export async function getAuthenticatedUser(request: Request) {
  const token = sessionToken(request);
  if (!token || token.length < 40 || token.length > 100) return null;
  const rows = await db.select({ id: users.id, login: users.login })
    .from(userSessions)
    .innerJoin(users, eq(userSessions.userId, users.id))
    .where(and(eq(userSessions.tokenHash, tokenDigest(token)), gt(userSessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

function attachSession(response: Response, request: Request, token: string) {
  const secure = request.url.startsWith("https:") || request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
  const cookie = `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure ? "; Secure" : ""}`;
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", cookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function createSession(request: Request, user: { id: string; login: string }, json: (body: unknown, status?: number) => Response) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await db.insert(userSessions).values({ tokenHash: tokenDigest(token), userId: user.id, expiresAt });
  return attachSession(json({ user }), request, token);
}

export async function registerAccount(request: Request, body: unknown, json: (body: unknown, status?: number) => Response) {
  checkRateLimit(request, "register", 8, 60 * 60 * 1000);
  const record = body !== null && typeof body === "object" ? body as Record<string, unknown> : {};
  const credentials = validateCredentials(record.login, record.password);
  const passwordHash = await hashPassword(credentials.password);
  const login = credentials.login.toLowerCase();

  const user = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(701234567890)`);
    const [legacy] = await tx.select({ id: users.id }).from(users).where(eq(users.id, LEGACY_OWNER_ID)).limit(1);
    if (legacy) throw Object.assign(new Error("Создание первого аккаунта владельца выполняется отдельно."), { status: 403 });
    const [created] = await tx.insert(users).values({ login, passwordHash }).returning({ id: users.id, login: users.login });
    await tx.insert(appSettings).values({ userId: created.id });
    return created;
  });
  return createSession(request, user, json);
}

export async function bootstrapFirstOwner(loginInput: string) {
  const login = validateLogin(loginInput);
  const password = randomBytes(24).toString("base64url");
  const passwordHash = await hashPassword(password);
  const normalizedLogin = login.toLowerCase();
  const user = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(701234567890)`);
    const [legacy] = await tx.select({ id: users.id }).from(users).where(eq(users.id, LEGACY_OWNER_ID)).limit(1);
    if (!legacy) throw new Error("Первый аккаунт уже создан.");
    const [claimed] = await tx.update(users).set({ login: normalizedLogin, passwordHash }).where(eq(users.id, LEGACY_OWNER_ID)).returning({ id: users.id, login: users.login });
    if (!claimed) throw new Error("Не удалось создать аккаунт владельца.");
    const [settings] = await tx.select({ id: appSettings.id }).from(appSettings).where(eq(appSettings.userId, claimed.id)).limit(1);
    if (!settings) await tx.insert(appSettings).values({ userId: claimed.id });
    return claimed;
  });
  return { user, password };
}

export async function loginAccount(request: Request, body: unknown, json: (body: unknown, status?: number) => Response) {
  checkRateLimit(request, "login", 12, 15 * 60 * 1000);
  const record = body !== null && typeof body === "object" ? body as Record<string, unknown> : {};
  const login = typeof record.login === "string" ? record.login.trim().toLowerCase() : "";
  const password = typeof record.password === "string" ? record.password : "";
  if (password.length > 128) return json({ error: "Неверный логин или пароль." }, 401);
  const [user] = await db.select().from(users).where(and(eq(users.login, login), ne(users.login, LEGACY_OWNER_LOGIN))).limit(1);
  const valid = user ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, "scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  if (!user || !valid) return json({ error: "Неверный логин или пароль." }, 401);
  return createSession(request, { id: user.id, login: user.login }, json);
}

export async function destroySession(request: Request) {
  const token = sessionToken(request);
  if (token && token.length <= 100) await db.delete(userSessions).where(eq(userSessions.tokenHash, tokenDigest(token)));
}

export async function hasRegisteredUsers() {
  const [user] = await db.select({ id: users.id }).from(users).where(ne(users.login, LEGACY_OWNER_LOGIN)).limit(1);
  return Boolean(user);
}

