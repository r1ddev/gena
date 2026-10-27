type JsonRecord = Record<string, unknown>;

const fallbackLabels: Record<string, string> = {
  WriteOff: "Списали товар",
  PotentiallyLost: "Ищем товар",
  WaitingShipment: "Ожидает отправки",
  ReceivedBySeller: "Получен",
  MovingToSeller: "Едет к продавцу",
  ReturningToSellerByCourier: "Курьер везёт возврат продавцу",
  ReturnedToOzon: "Возврат на складе Ozon",
  MovingToOzon: "Едет на склад Ozon",
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function parsedDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function resolveOzonReturnTimeline(raw: unknown) {
  const value = record(raw);
  const visual = record(value.visual);
  const visualStatus = record(visual.status);
  const systemName = typeof visualStatus.sys_name === "string" ? visualStatus.sys_name.toLowerCase() : "";
  const changedAt = parsedDate(visual.change_moment) ?? parsedDate(record(value.logistic).final_moment);
  const finalStatus = systemName === "receivedbyseller"
    ? "seller"
    : systemName === "returnedtoozon"
      ? "ozon"
      : systemName === "writeoff" ? "writeoff" : null;

  return {
    finalStatus,
    receivedBySellerAt: finalStatus === "seller" ? changedAt : null,
    availableAtOzon: finalStatus === "ozon" ? changedAt : null,
    writtenOffAt: finalStatus === "writeoff" ? changedAt : null,
  } as const;
}

export function isOzonWriteOffStatus(status: unknown, raw?: unknown) {
  const visualStatus = record(record(record(raw).visual).status);
  const systemName = typeof visualStatus.sys_name === "string" ? visualStatus.sys_name : "";
  const value = typeof status === "string" ? status.trim().toLowerCase() : "";
  return systemName.toLowerCase() === "writeoff" || value === "writeoff" || value === "списали товар";
}

export function ozonReturnStatusLabel(status: unknown, raw?: unknown) {
  const visualStatus = record(record(record(raw).visual).status);
  const systemName = typeof visualStatus.sys_name === "string" ? visualStatus.sys_name : "";
  const value = typeof status === "string" ? status.trim() : "";
  const displayName = typeof visualStatus.display_name === "string" ? visualStatus.display_name.trim() : "";
  if (displayName && displayName !== systemName) return displayName;
  const code = systemName || value;
  if (fallbackLabels[code]) return fallbackLabels[code];
  if (value && Object.values(fallbackLabels).includes(value)) return value;
  if (!systemName && value && value.toLowerCase() !== "unknown") return value;
  return code && code !== "unknown" ? "Статус Ozon" : "Статус не передан Ozon";
}
