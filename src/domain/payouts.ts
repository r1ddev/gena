export type PayoutCategory = { key: string; label: string; amount: number };
export type PayoutServiceItem = { label: string; amount: number };
export type PayoutServiceGroup = { key: string; label: string; total: number | null; items: PayoutServiceItem[] };
export type PayoutStatementBreakdown = {
  categories: PayoutCategory[];
  serviceGroups: PayoutServiceGroup[];
  beginBalance: number | null;
  endBalance: number | null;
};

type JsonRecord = Record<string, unknown>;

const payoutServiceLabels: Record<string, string> = {
  AccrualConsigDefectiveWriteOff: "Списание бракованного товара",
  AccrualConsigWriteOff: "Списание товара",
  AccrualInternalClaim: "Внутренняя претензия Ozon",
  AccrualWithoutDocs: "Начисление без документов",
  InsuranceServiceSellerItem: "Страхование товара",
  MarketplaceElectronicServiceAcceleratedProductReviews: "Сбор отзывов",
  MarketplaceRedistributionOfAcquiringItem: "Эквайринг по товару",
  MarketplaceRedistributionOfAcquiringOperation: "Эквайринг",
  MarketplaceSellerCostOperationAggregate: "Общие расходы продавца",
  MarketplaceSellerDecompensationItemByTypeDocOperation: "Компенсация продавцу",
  MarketplaceServiceCostPerClick: "Продвижение за клик",
  MarketplaceServiceItemCrossdocking: "Кросс-докинг",
  MarketplaceServiceItemDeliveryToHandoverPlaceOzon: "Доставка до пункта выдачи Ozon",
  MarketplaceServiceItemDirectFlowLogisticSum: "Доставка покупателю",
  MarketplaceServiceItemPackageMaterialsProvision: "Упаковочные материалы",
  MarketplaceServiceItemRedistributionLastMileCourier: "Последняя миля курьером",
  MarketplaceServiceItemRedistributionReturnsPVZ: "Возврат через пункт выдачи",
  MarketplaceServiceItemReturnAfterDelivToCustomer: "Возврат после выдачи покупателю",
  MarketplaceServiceItemReturnFlowLogistic: "Обратная логистика",
  MarketplaceServiceItemReturnNotDelivToCustomer: "Возврат недоставленного заказа",
  MarketplaceServiceItemSupplyInboundCargoSurplus: "Обработка излишков в поставке",
  MarketplaceServiceProductMovementFromWarehouse: "Перемещение товара со склада",
  MarketplaceServicePromotionWithCostPerOrder: "Продвижение с оплатой за заказ",
  MarketplaceServiceSellerReturnsCargoAssortment: "Возврат товара со склада Ozon",
  MarketplaceServiceStorageItem: "Хранение товара",
  MarketplaceServiseItemAgencyFeeForSale: "Комиссия Ozon за продажу",
  MarketplaceServiseItemPointsAwarded: "Баллы за скидку",
  OperationMarketplaceAgencyFeeForDirectSale: "Комиссия за прямую продажу",
  OperationMarketplaceAgencyFeeForSale: "Комиссия за продажу",
  OperationMarketplacePointsAwarded: "Баллы за скидку",
  OperationMarketplacePointsAwardedDirect: "Баллы за прямую продажу",
  SaleCommissionsDirectFlowBankCoinvestmentDistributedOperation: "Компенсация скидки банком",
  SaleCommissionsDirectFlowSaleIncomeOperation: "Выручка по продаже",
};

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function records(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value.map(record).filter((item): item is JsonRecord => item !== null);
}

function amount(value: unknown): number | null {
  const direct = record(value)?.amount ?? value;
  if (typeof direct !== "number" && typeof direct !== "string") return null;
  const parsed = Number(direct);
  return Number.isFinite(parsed) ? parsed : null;
}

function amountFromItems(items: PayoutServiceItem[]) {
  return items.reduce((total, item) => total + item.amount, 0);
}

function serviceItems(value: unknown): PayoutServiceItem[] {
  return records(value).flatMap((item) => {
    const itemAmount = amount(item.price ?? item.amount);
    if (itemAmount === null) return [];
    const itemLabel = item.name ?? item.label;
    const sourceLabel = typeof itemLabel === "string" ? itemLabel.trim() : "";
    const machineCode = /^[A-Z][A-Za-z0-9]+$/.test(sourceLabel);
    const label = payoutServiceLabels[sourceLabel] ?? (machineCode ? "Прочая услуга Ozon" : sourceLabel || "Услуга без названия");
    return [{ label, amount: itemAmount }];
  });
}

function serviceGroup(
  key: string,
  label: string,
  value: unknown,
  nestedItemsKey?: string,
): PayoutServiceGroup | null {
  const source = record(value);
  if (!source) return null;
  const itemSource = nestedItemsKey ? record(source[nestedItemsKey]) : source;
  const items = serviceItems(itemSource?.items);
  const total = amount(source.total) ?? amount(source.amount) ?? (items.length ? amountFromItems(items) : null);
  if (total === null && items.length === 0) return null;
  return { key, label, total, items };
}

function singleAmountGroup(key: string, label: string, value: unknown): PayoutServiceGroup | null {
  const total = amount(value);
  if (total === null || total === 0) return null;
  return { key, label, total, items: [] };
}

/** Parses the period-level breakdown returned with Ozon payout reports. */
export function parseOzonPayoutStatement(rawValue: unknown, currencyCode = "RUB"): PayoutStatementBreakdown {
  const raw = record(rawValue) ?? {};
  const details = record(raw.details) ?? {};
  const cashFlows = records(raw.cashFlows ?? raw.cash_flows).filter((cashFlow) => {
    const currency = typeof cashFlow.currency_code === "string" ? cashFlow.currency_code.toUpperCase() : "";
    return !currency || currency === currencyCode.toUpperCase();
  });
  const categoryFields = [
    ["orders_amount", "Продажи"],
    ["returns_amount", "Возвраты"],
    ["commission_amount", "Комиссия Ozon"],
    ["item_delivery_and_return_amount", "Доставка и возвраты"],
    ["services_amount", "Услуги Ozon"],
  ] as const;
  const categories = categoryFields.flatMap(([key, label]) => {
    const values = cashFlows.map((cashFlow) => amount(cashFlow[key])).filter((value): value is number => value !== null);
    return values.length ? [{ key, label, amount: values.reduce((total, value) => total + value, 0) }] : [];
  });

  const delivery = record(details.delivery) ?? {};
  const returns = record(details.return) ?? {};
  const rfbs = record(details.rfbs) ?? {};
  const rfbsItems = [
    ["transfer_delivery", "Доставка покупателю"],
    ["transfer_delivery_return", "Возврат доставки"],
    ["compensation_delivery_return", "Компенсация доставки при возврате"],
    ["partial_compensation", "Частичная компенсация"],
    ["partial_compensation_return", "Возврат частичной компенсации"],
  ].flatMap(([key, label]) => {
    const value = amount(rfbs[key]);
    return value === null || value === 0 ? [] : [{ label, amount: value }];
  });
  const rfbsTotal = amount(rfbs.total);
  const rfbsGroup = (rfbsTotal !== null && rfbsTotal !== 0) || rfbsItems.length > 0
    ? serviceGroup("rfbs", "Доставка продавцом", { ...rfbs, items: rfbsItems })
    : null;
  const serviceGroups = [
    serviceGroup("delivery", "Доставка", delivery, "delivery_services"),
    serviceGroup("returns", "Возвраты", returns, "return_services"),
    serviceGroup("services", "Услуги Ozon", details.services),
    serviceGroup("others", "Другие операции", details.others),
    singleAmountGroup("loan", "Перевод по займу", details.loan),
    singleAmountGroup("invoice_transfer", "Перевод по счёту", details.invoice_transfer),
    rfbsGroup,
  ].filter((group): group is PayoutServiceGroup => group !== null);

  return {
    categories,
    serviceGroups,
    beginBalance: amount(details.begin_balance_amount),
    endBalance: amount(details.end_balance_amount),
  };
}
