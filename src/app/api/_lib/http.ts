import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getAuthenticatedUser } from "@/security/auth";

const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isPrivateNetworkHost(host: string) {
  if (isIP(host) === 4) {
    const [first, second] = host.split(".").map(Number);
    return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 169 && second === 254);
  }

  const ipv6 = host.replace(/^\[|\]$/g, "");
  return isIP(ipv6) === 6 && (/^(fc|fd)/.test(ipv6) || /^fe[89ab]/.test(ipv6));
}

function getConfiguredPublicOrigin() {
  const value = process.env.APP_PUBLIC_ORIGIN?.trim();
  if (!value) return undefined;
  try {
    const origin = new URL(value);
    if (
      origin.protocol !== "https:" ||
      origin.origin !== value ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    ) return undefined;
    return origin;
  } catch {
    return undefined;
  }
}

function getRequestHost(rawHost: string | null) {
  if (!rawHost) return undefined;
  try {
    const url = new URL(`http://${rawHost}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return undefined;
    return { hostname: url.hostname.toLowerCase(), authority: rawHost.toLowerCase() };
  } catch {
    return undefined;
  }
}

function isAllowedRequestHost(host: string, authority: string) {
  if (localHosts.has(host) || isPrivateNetworkHost(host)) return true;
  const publicOrigin = getConfiguredPublicOrigin();
  return Boolean(
    publicOrigin &&
    host === publicOrigin.hostname &&
    [publicOrigin.hostname, publicOrigin.host].includes(authority),
  );
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function errorResponse(error: unknown) {
  if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
    const message = error instanceof Error ? error.message : "Не удалось выполнить запрос.";
    return json({ error: message, message }, error.status);
  }
  if (error instanceof ZodError) {
    return json({ error: "Некорректные данные", details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) }, 400);
  }
  const message = error instanceof Error ? error.message : "";
  if (!/[\u0400-\u04FF]/.test(message)) {
    console.error("API request failed:", error);
    return json({ error: "Внутренняя ошибка сервера.", message: "Внутренняя ошибка сервера." }, 500);
  }
  const status = /не найдена|не найден|не существует/i.test(message) ? 404 : 400;
  return json({ error: message, message }, status);
}

export async function handleLocalGet<T>(request: Request, operation: (userId: string) => Promise<T>) {
  try {
    assertLocalRequest(request);
    const user = await getAuthenticatedUser(request);
    if (!user) return json({ error: "Для продолжения войдите в аккаунт." }, 401);
    return json(await operation(user.id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function requireAuthenticatedUser(request: Request) {
  assertLocalRequest(request);
  const user = await getAuthenticatedUser(request);
  if (!user) {
    const error = new Error("Для продолжения войдите в аккаунт.") as Error & { status: number };
    error.status = 401;
    throw error;
  }
  return user.id;
}

export async function requireAuthenticatedMutation(request: Request) {
  assertLocalMutation(request);
  return requireAuthenticatedUser(request);
}

export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new Error("Тело запроса должно быть корректным JSON.");
  }
  return schema.parse(body);
}

export function assertLocalRequest(request: Request) {
  const rawHost = request.headers.get("host");
  const host = getRequestHost(rawHost);
  if (!host || !isAllowedRequestHost(host.hostname, host.authority)) {
    throw new Error("Приложение доступно только на этом компьютере и в локальной сети.");
  }
}

export function assertLocalMutation(request: Request) {
  assertLocalRequest(request);
  const rawHost = request.headers.get("host");
  const requestHost = getRequestHost(rawHost);
  const publicOrigin = getConfiguredPublicOrigin();
  const isPublicRequest = Boolean(
    requestHost &&
    publicOrigin &&
    requestHost.hostname === publicOrigin.hostname &&
    [publicOrigin.hostname, publicOrigin.host].includes(requestHost.authority),
  );
  const requestUrl = new URL(request.url);
  const expectedOrigins = isPublicRequest && publicOrigin
    ? new Set([publicOrigin.origin])
    : new Set([
        new URL(`${requestUrl.protocol}//${rawHost ?? ""}`).origin,
        new URL(`http://${rawHost ?? ""}`).origin,
      ]);
  const origin = request.headers.get("origin");
  if (origin) {
    let originUrl: URL;
    try {
      originUrl = new URL(origin);
    } catch {
      throw new Error("Некорректный источник запроса.");
    }
    const originHost = originUrl.hostname.toLowerCase();
    const isAllowedOriginHost = localHosts.has(originHost) || isPrivateNetworkHost(originHost) ||
      (isPublicRequest && publicOrigin?.origin === originUrl.origin);
    if (
      !isAllowedOriginHost ||
      !expectedOrigins.has(originUrl.origin) ||
      originUrl.username ||
      originUrl.password ||
      originUrl.pathname !== "/" ||
      originUrl.search ||
      originUrl.hash
    ) throw new Error("Источник запроса не совпадает с локальным адресом приложения.");
  }
}
