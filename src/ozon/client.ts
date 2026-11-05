import { randomUUID } from "node:crypto";

const API_ROOT = "https://api-seller.ozon.ru";
const MIN_REQUEST_INTERVAL_MS = 2_000;
let lastRequestAt = 0;
const MAX_LABEL_FILE_BYTES = 25 * 1024 * 1024;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class OzonApiError extends Error {
  constructor(message: string, readonly status?: number, readonly retryAfter?: string | null) {
    super(message);
    this.name = "OzonApiError";
  }
}

export function ozonRetryDelay(attempt: number, retryAfter?: string | null, nowMs = Date.now()) {
  const retryNumber = Number(retryAfter);
  const retryDate = retryAfter && !Number.isFinite(retryNumber) ? Date.parse(retryAfter) : Number.NaN;
  const serverDelay = Number.isFinite(retryNumber) && retryNumber >= 0
    ? retryNumber * 1_000
    : Number.isFinite(retryDate) ? Math.max(0, retryDate - nowMs) : 0;
  const backoff = 2_000 * (2 ** Math.max(0, Math.floor(attempt)));
  return Math.max(Math.min(120_000, backoff), serverDelay);
}

export function ozonRequestWait(previousRequestAt: number, nowMs = Date.now()) {
  if (previousRequestAt <= 0) return 0;
  return Math.max(0, MIN_REQUEST_INTERVAL_MS - (nowMs - previousRequestAt));
}

export function ozonInteger(value: string) {
  if (!/^\d+$/.test(value)) throw new OzonApiError("Ozon integer identifiers must contain digits only.");
  return { __ozonRawInteger: value };
}

export async function ozonPost<T>(
  path: string,
  body: unknown,
  credentials: { clientId: string; apiKey: string },
  options: { maxAttempts?: number; timeoutMs?: number } = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 7);
  const timeoutMs = options.timeoutMs ?? 30_000;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await sleep(ozonRequestWait(lastRequestAt));
      lastRequestAt = Date.now();
      const response = await fetch(`${API_ROOT}${path}`, {
        method: "POST",
        headers: {
          "Client-Id": credentials.clientId,
          "Api-Key": credentials.apiKey,
          "Content-Type": "application/json",
        },
        body: stringifyOzonBody(body),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      const text = await response.text();
      if (!response.ok) {
        const detail = safeError(text);
        const error = new OzonApiError(`Ozon ${path} returned ${response.status}: ${detail}`, response.status, response.headers.get("retry-after"));
        if (response.status === 429 || response.status >= 500) throw error;
        throw error;
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new OzonApiError(`Ozon ${path} returned invalid JSON.`);
      }
    } catch (error) {
      lastError = error;
      const retryable = error instanceof OzonApiError ? error.status === 429 || (error.status ?? 0) >= 500 : true;
      if (!retryable || attempt === maxAttempts - 1) break;
      const retryAfter = error instanceof OzonApiError ? error.retryAfter : null;
      await new Promise((resolve) => setTimeout(resolve, ozonRetryDelay(attempt, retryAfter)));
    }
  }
  throw lastError instanceof Error ? lastError : new OzonApiError("Could not reach Ozon Seller API.");
}

function stringifyOzonBody(body: unknown) {
  const integers = new Map<string, string>();
  const json = JSON.stringify(body, (_key, value: unknown) => {
    if (value && typeof value === "object" && "__ozonRawInteger" in value) {
      const raw = (value as { __ozonRawInteger: unknown }).__ozonRawInteger;
      if (typeof raw !== "string" || !/^\d+$/.test(raw)) throw new OzonApiError("Ozon integer identifiers must contain digits only.");
      const marker = `__OZON_RAW_INTEGER_${randomUUID()}__`;
      integers.set(marker, raw);
      return marker;
    }
    return value;
  });
  return [...integers].reduce((result, [marker, raw]) => result.replace(JSON.stringify(marker), raw), json ?? "null");
}

export async function ozonDownloadLabelFile(
  fileGuid: string | null,
  fileUrl: string | null,
  credentials: { clientId: string; apiKey: string },
) {
  if (!fileGuid && !fileUrl) throw new OzonApiError("Ozon did not return a label file identifier.");
  let url = fileUrl ? trustedLabelUrl(fileUrl) : new URL(`/v1/cargoes-label/file/${encodeURIComponent(fileGuid!)}`, API_ROOT);

  for (let redirects = 0; redirects <= 3; redirects += 1) {
    await sleep(ozonRequestWait(lastRequestAt));
    lastRequestAt = Date.now();
    const response = await fetch(url, {
      method: "GET",
      headers: url.hostname === "api-seller.ozon.ru"
        ? { "Client-Id": credentials.clientId, "Api-Key": credentials.apiKey }
        : undefined,
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) throw new OzonApiError("Ozon returned an invalid label download redirect.");
      url = trustedLabelUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) {
      const detail = safeError(await response.text());
      throw new OzonApiError(`Ozon label download returned ${response.status}: ${detail}`, response.status);
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType && contentType !== "application/pdf" && contentType !== "application/octet-stream") {
      throw new OzonApiError("Ozon returned a file that is not a PDF label document.");
    }
    return readLimitedFile(response);
  }
  throw new OzonApiError("Ozon label download exceeded the redirect limit.");
}

function trustedLabelUrl(value: string) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const isOzonHost = hostname === "api-seller.ozon.ru"
    || hostname.endsWith(".ozon.ru")
    || hostname === "ozone.ru"
    || hostname.endsWith(".ozone.ru")
    || hostname === "ozonusercontent.com"
    || hostname.endsWith(".ozonusercontent.com");
  if (url.protocol !== "https:" || !isOzonHost || url.username || url.password || (url.port && url.port !== "443")) {
    throw new OzonApiError("Ozon returned an unsupported label download link.");
  }
  return url;
}

async function readLimitedFile(response: Response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_LABEL_FILE_BYTES) {
    await response.body?.cancel();
    throw new OzonApiError("Ozon label file is larger than the allowed download size.");
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_LABEL_FILE_BYTES) {
      await reader.cancel();
      throw new OzonApiError("Ozon label file is larger than the allowed download size.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

function safeError(text: string) {
  try {
    const parsed = JSON.parse(text) as { message?: string; error?: string; code?: string };
    return parsed.message ?? parsed.error ?? parsed.code ?? "request failed";
  } catch {
    return text.slice(0, 240).replace(/(api[-_ ]?key|client[-_ ]?id)\s*[:=]\s*\S+/gi, "$1=[hidden]");
  }
}
