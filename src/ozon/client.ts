const API_ROOT = "https://api-seller.ozon.ru";

export class OzonApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "OzonApiError";
  }
}

export async function ozonPost<T>(path: string, body: unknown, credentials: { clientId: string; apiKey: string }): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
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
        const error = new OzonApiError(`Ozon ${path} returned ${response.status}: ${detail}`, response.status);
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
      if (!retryable || attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
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
