import { getImportCellValue, parseImportMoney } from "./workbook";

export function getImportedReceivedQuantity(cells: Record<string, unknown>, orderedQuantity: number) {
  const value = getImportCellValue(cells, ["полученное количество", "получено", "получен", "received quantity", "received"]);
  const quantity = parseImportMoney(value);
  if (quantity !== null) return quantity;
  if (typeof value !== "string") return 0;
  return /^(да|yes|true|1|получен|выполнен|выполнена|доставлен|received)$/i.test(value.trim()) ? orderedQuantity : 0;
}

export function shouldDeleteImportedReceipt(receivedQuantity: number) {
  return receivedQuantity <= 0;
}
