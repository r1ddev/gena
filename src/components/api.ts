export type JsonRecord = Record<string, unknown>;

export function localToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...init?.headers },
    cache: "no-store",
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text) as unknown; }
    catch { body = text; }
  }
  if (!response.ok) {
    const record = asRecord(body);
    const message = stringValue(record?.message) ?? stringValue(record?.error) ?? (typeof body === "string" ? body : null);
    throw new Error(message || `Не удалось выполнить запрос (${response.status})`);
  }
  return body;
}

export function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function findRows(value: unknown, depth = 0): JsonRecord[] {
  if (depth > 4 || value == null) return [];
  if (Array.isArray(value)) return value.map(asRecord).filter((row): row is JsonRecord => row !== null);
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ["items", "rows", "results", "products", "records", "data"]) {
    const nested = record[key];
    if (Array.isArray(nested)) return findRows(nested, depth + 1);
  }
  for (const key of ["data", "result", "payload"]) {
    const nested = record[key];
    if (nested && typeof nested === "object") {
      const rows = findRows(nested, depth + 1);
      if (rows.length) return rows;
    }
  }
  return [];
}

export function valueAt(record: JsonRecord, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => asRecord(value)?.[key], record);
}

export function displayValue(value: unknown, kind?: "money" | "quantity" | "date" | "status"): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (typeof value === "number" || (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim()))) {
    const number = Number(value);
    if (Number.isFinite(number) && (kind === "money" || kind === "quantity")) {
      return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: kind === "money" ? 2 : 0, maximumFractionDigits: kind === "money" ? 2 : 3 }).format(number) + (kind === "money" ? " ₽" : "");
    }
  }
  if (typeof value === "string" && kind === "date") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      const row = asRecord(item);
      if (!row) return String(item);
      const title = String(row.title ?? row.name ?? row.sku ?? "");
      const internalSku = stringValue(row.sku);
      const offerId = stringValue(row.offerId);
      const ozonSku = stringValue(row.ozonSku);
      const article = internalSku ?? offerId ?? ozonSku;
      const articleLabel = article ? ` · Артикул ${article}` : "";
      const secondaryIdentifiers = [
        offerId && offerId !== article ? `Артикул продавца ${offerId}` : null,
        ozonSku && ozonSku !== article && ozonSku !== offerId ? `SKU Ozon ${ozonSku}` : null,
      ].filter((identifier): identifier is string => identifier !== null);
      const otherIdentifiers = secondaryIdentifiers.length ? ` · ${secondaryIdentifiers.join(" · ")}` : "";
      return title ? `${title}${articleLabel}${otherIdentifiers}${row.quantity != null ? ` × ${displayValue(row.quantity, "quantity")}` : ""}` : JSON.stringify(item);
    }).join("; ") || "—";
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function getId(row: JsonRecord): string | null {
  const id = row.id ?? row.uuid ?? row.productId ?? row.externalId;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}
