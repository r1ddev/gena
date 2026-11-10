const API_ROOT = "https://api-seller.ozon.ru";
const MIN_REQUEST_INTERVAL_MS = 2_000;
let lastRequestAt = 0;

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

export async function ozonPost<T>(path: string, body: unknown, credentials: { clientId: string; apiKey: string }): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 7; attempt += 1) {
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
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
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
      if (!retryable || attempt === 6) break;
      const retryAfter = error instanceof OzonApiError ? error.retryAfter : null;
      await new Promise((resolve) => setTimeout(resolve, ozonRetryDelay(attempt, retryAfter)));
    }
  }
  throw lastError instanceof Error ? lastError : new OzonApiError("Could not reach Ozon Seller API.");
}

function safeError(text: string) {
  try {
    const parsed = JSON.parse(text) as { message?: string; error?: string; code?: string };
    return parsed.message ?? parsed.error ?? parsed.code ?? "request failed";
  } catch {
    return text.slice(0, 240).replace(/(api[-_ ]?key|client[-_ ]?id)\s*[:=]\s*\S+/gi, "$1=[hidden]");
  }
}
