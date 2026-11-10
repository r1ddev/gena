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
  return code && code !== "unknown" ? "Статус Ozon" : "Статус не передан Ozon";
}
