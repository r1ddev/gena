import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function errorResponse(error: unknown) {
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

export async function handleLocalGet<T>(request: Request, operation: () => Promise<T>) {
  try {
    assertLocalRequest(request);
    return json(await operation());
  } catch (error) {
    return errorResponse(error);
  }
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
  let host = "";
  try { host = new URL(`http://${rawHost ?? ""}`).hostname.toLowerCase(); } catch { /* reject below */ }
  if (!host || !localHosts.has(host)) throw new Error("Приложение принимает изменения только с локального компьютера.");
}

export function assertLocalMutation(request: Request) {
  assertLocalRequest(request);
  const rawHost = request.headers.get("host");
  const requestUrl = new URL(request.url);
  const expectedOrigin = new URL(`${requestUrl.protocol}//${rawHost ?? ""}`).origin;
  const origin = request.headers.get("origin");
  if (origin) {
    let originUrl: URL;
    try {
      originUrl = new URL(origin);
    } catch {
      throw new Error("Некорректный источник запроса.");
    }
    const originHost = originUrl.hostname.toLowerCase();
    if (
      !localHosts.has(originHost) ||
      originUrl.origin !== expectedOrigin ||
      originUrl.username ||
      originUrl.password ||
      originUrl.pathname !== "/" ||
      originUrl.search ||
      originUrl.hash
    ) throw new Error("Источник запроса не совпадает с локальным адресом приложения.");
  }
}
