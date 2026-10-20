import { getImportCellValue, parseImportDate } from "./workbook";

function normalizedStatus(value: string) {
  return value.trim().toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replace(/\s+/gu, " ");
}

export function isDeliveredSaleStatus(value: string) {
  const status = normalizedStatus(value);
  if (!status || /не[\s-]*(?:доставлен|вручен|выкуплен?)|not[\s-]*delivered|отмен|cancel|отказ|reject|возврат|return/u.test(status)) return false;
  return /(?:^|[^\p{L}])(?:доставлен\p{L}*|вручен\p{L}*|delivered)(?=$|[^\p{L}])/u.test(status);
}

export function isMarketplaceBuyoutStatus(value: string) {
  const status = normalizedStatus(value);
  if (!status || /не[\s-]*выкуп|not[\s-]*bought|отмен|cancel|возврат|return/u.test(status)) return false;
  return /выкуп\p{L}*.*маркетплейс|marketplace\s+buyout/u.test(status);
}

export function isImportableSaleMovement(value: string) {
  return isDeliveredSaleStatus(value) || isMarketplaceBuyoutStatus(value);
}

export function getSaleAmountImportIssue(amount: number | null, status: string): "negative" | "missing" | null {
  if (amount !== null && amount < 0) return "negative";
  if (amount === null && isDeliveredSaleStatus(status) && !isMarketplaceBuyoutStatus(status)) return "missing";
  return null;
}

export function getImportedBuyerDeliveryDate(cells: Record<string, unknown>) {
  return parseImportDate(getImportCellValue(cells, [
    "дата передачи покупателю",
    "дата вручения покупателю",
    "дата доставки покупателю",
    "дата вручения",
    "buyer handoff date",
    "buyer delivery date",
    "delivered at",
    "delivered date",
  ]));
}
