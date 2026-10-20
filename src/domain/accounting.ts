import Decimal from "decimal.js";

Decimal.set({ precision: 24, rounding: Decimal.ROUND_HALF_UP });

export type AccountingInput = {
  products: { id: string; sku: string; title: string }[];
  purchases: { id: string; amountPaid: string | number }[];
  receipts: { productId: string; quantity: string | number; unitCost: string | number; receivedAt?: string }[];
  supplies: { productId: string; quantity: string | number; shippingCost: string | number; suppliedAt?: string }[];
  expenses: { amount: string | number; spentAt?: string }[];
  postings: {
    id: string;
    status: string;
    deliveredAt: string | null;
    marketplaceBuyoutAt?: string | null;
    isMarketplaceBuyout: boolean;
    accountingEnabled?: boolean;
  }[];
  postingItems: {
    postingId: string;
    productId: string | null;
    quantity: string | number;
    price: string | number;
    ignored?: boolean;
    movementEnabled?: boolean;
    ozonSku?: string;
    isMarketplaceBuyout?: boolean;
    marketplaceBuyoutAt?: string | null;
  }[];
  financeAccruals: { postingId: string | null; productId?: string | null; ozonSku?: string | null; amount: string | number; category?: string; accrualDate?: string; isOzonWriteoffCompensation?: boolean; ignored?: boolean }[];
  returns: {
    externalId?: string;
    postingId: string | null;
    productId: string | null;
    quantity: string | number;
    destination: "seller" | "ozon" | "unknown";
    returnedAt?: string | null;
    receivedBySellerAt: string | null;
    availableAtOzon: string | null;
  }[];
  manualWriteoffs: { productId: string; quantity: string | number; writtenOffAt?: string }[];
  ozonWriteoffs: { productId: string | null; quantity: string | number; occurredAt?: string | null; compensationStatus?: string; compensationAmount?: string | number | null }[];
  stockAdjustments: { productId: string; warehouse: "seller" | "ozon"; actualQuantity: string | number; countedAt?: string }[];
};

export type ProductAccounting = {
  productId: string;
  sku: string;
  title: string;
  receivedQuantity: string;
  averagePurchaseCost: string | null;
  landedUnitCost: string | null;
  sellerStock: string;
  ozonStock: string;
};

export type AccountingResult = {
  cashBalance: string;
  confirmedProfit: string | null;
  cashBreakdown: {
    recognizedOzon: string;
    recognizedOzonOther: string;
    ozonWriteoffCompensation: string;
    purchases: string;
    expenses: string;
    supplyShipping: string;
    total: string;
  };
  profitBreakdown: {
    recognizedOzon: string;
    recognizedOzonOther: string;
    ozonWriteoffCompensation: string;
    soldPurchaseCost: string;
    soldSharedCosts: string;
    manualLossPurchaseCost: string;
    manualLossSharedCosts: string;
    ozonWriteoffPurchaseCost: string;
    ozonWriteoffSharedCosts: string;
    total: string | null;
  };
  sharedExpenseCoefficient: string;
  receivedPurchaseValue: string;
  sharedExpenses: string;
  preliminaryOrders: { count: number; grossAmount: string; expectedProfit: string | null };
  products: ProductAccounting[];
  costingIssues: { productId: string; sku: string; title: string }[];
  reconciliationErrors: { productId: string; sku: string; warehouse: "seller" | "ozon"; quantity: string }[];
  profitReconciliationIssues: { externalId: string; productId: string; sku: string }[];
  recognizedPostingIds: string[];
  unrecognizedFinanceAmount: string;
};

const d = (value: string | number | null | undefined) => new Decimal(value ?? 0);
const sum = (values: Decimal[]) => values.reduce((total, value) => total.plus(value), new Decimal(0));
const money = (value: Decimal) => value.toDecimalPlaces(2).toFixed(2);
const units = (value: Decimal) => value.toDecimalPlaces(3).toFixed(3);
const dayMs = 24 * 60 * 60 * 1000;
type PostingInput = AccountingInput["postings"][number];
type PostingItemInput = AccountingInput["postingItems"][number];

function isEffectiveAt(at: string | null | undefined, now: Date) {
  if (!at) return true;
  const timestamp = Date.parse(at);
  return Number.isFinite(timestamp) && timestamp <= now.getTime();
}

function isDelivered(posting: AccountingInput["postings"][number], asOf: Date) {
  return Boolean(posting.deliveredAt) && Date.parse(posting.deliveredAt!) <= asOf.getTime();
}

function isMarketplaceBuyoutItem(posting: PostingInput, item: PostingItemInput) {
  return item.isMarketplaceBuyout === true || posting.isMarketplaceBuyout;
}

function isRecognizedItem(posting: PostingInput, item: PostingItemInput, now: Date) {
  if (item.movementEnabled === false) return false;
  if (isMarketplaceBuyoutItem(posting, item)) {
    const buyoutAt = item.marketplaceBuyoutAt ?? (posting.isMarketplaceBuyout ? posting.marketplaceBuyoutAt : null);
    return Boolean(buyoutAt) && Date.parse(buyoutAt!) <= now.getTime();
  }
  if (!isDelivered(posting, now)) return false;
  return now.getTime() >= new Date(posting.deliveredAt!).getTime() + 21 * dayMs;
}

function isRecognized(posting: PostingInput, items: PostingItemInput[], now: Date) {
  return items.length > 0 && items.every((item) => isRecognizedItem(posting, item, now));
}

function isCancelled(posting: AccountingInput["postings"][number]) {
  return /cancel|отмен|declin|reject/i.test(posting.status);
}

function isAccountableItem(item: PostingItemInput) {
  return item.productId !== null && !item.ignored;
}

export function hasAccountablePostingItems(items: { productId: string | null; ignored?: boolean }[]) {
  const hasMappedItem = items.some((item) => item.productId !== null && !item.ignored);
  const allItemsResolved = items.every((item) => item.ignored || item.productId !== null);
  return items.length > 0 && hasMappedItem && allItemsResolved;
}

function hasCompleteProductMapping(posting: AccountingInput["postings"][number], items: AccountingInput["postingItems"]) {
  if (posting.accountingEnabled !== undefined) return posting.accountingEnabled;
  const postingItems = items.filter((item) => item.postingId === posting.id);
  return hasAccountablePostingItems(postingItems);
}

export function isPostingRecognized(posting: PostingInput, items: PostingItemInput[], now = new Date()) {
  return hasCompleteProductMapping(posting, items) && isRecognized(posting, items.filter(isAccountableItem), now);
}

export function calculateAccounting(input: AccountingInput, now = new Date()): AccountingResult {
  const productById = new Map(input.products.map((product) => [product.id, product]));
  const postingById = new Map(input.postings.map((posting) => [posting.id, posting]));
  const recognizedPostings = new Set(
    input.postings.filter((posting) => {
      const items = input.postingItems.filter((item) => item.postingId === posting.id && isAccountableItem(item));
      return hasCompleteProductMapping(posting, input.postingItems) && isRecognized(posting, items, now);
    }).map((posting) => posting.id),
  );
  const mappablePostingIds = new Set(
    input.postings.filter((posting) => hasCompleteProductMapping(posting, input.postingItems)).map((posting) => posting.id),
  );

  const receivedByProduct = new Map<string, Decimal>();
  const receivedValueByProduct = new Map<string, Decimal>();
  for (const receipt of input.receipts) {
    if (!isEffectiveAt(receipt.receivedAt, now)) continue;
    const receivedQty = d(receipt.quantity);
    receivedByProduct.set(receipt.productId, (receivedByProduct.get(receipt.productId) ?? new Decimal(0)).plus(receivedQty));
    const purchaseValue = receivedQty.times(d(receipt.unitCost));
    receivedValueByProduct.set(receipt.productId, (receivedValueByProduct.get(receipt.productId) ?? new Decimal(0)).plus(purchaseValue));
  }

  const receivedPurchaseValue = sum([...receivedValueByProduct.values()]);
  const sharedExpenses = sum([
    ...input.expenses.filter((expense) => isEffectiveAt(expense.spentAt, now)).map((expense) => d(expense.amount)),
    ...input.supplies.filter((supply) => isEffectiveAt(supply.suppliedAt, now)).map((supply) => d(supply.shippingCost)),
  ]);
  const sharedExpenseCoefficient = receivedPurchaseValue.isZero()
    ? new Decimal(0)
    : sharedExpenses.div(receivedPurchaseValue);

  const averageByProduct = new Map<string, Decimal>();
  const landedByProduct = new Map<string, Decimal>();
  for (const product of input.products) {
    const qty = receivedByProduct.get(product.id) ?? new Decimal(0);
    const value = receivedValueByProduct.get(product.id) ?? new Decimal(0);
    if (qty.gt(0) && value.gt(0)) {
      const average = value.div(qty);
      averageByProduct.set(product.id, average);
      landedByProduct.set(product.id, average.times(new Decimal(1).plus(sharedExpenseCoefficient)));
    }
  }

  const sellerStock = new Map<string, Decimal>();
  const ozonStock = new Map<string, Decimal>();
  const add = (map: Map<string, Decimal>, productId: string | null, amount: Decimal) => {
    if (!productId) return;
    map.set(productId, (map.get(productId) ?? new Decimal(0)).plus(amount));
  };

  type StockEvent = { productId: string; warehouse: "seller" | "ozon"; at: string; delta?: Decimal; actual?: Decimal };
  const stockEvents: StockEvent[] = [];
  const stockEvent = (productId: string | null, warehouse: "seller" | "ozon", at: string | null | undefined, value: Decimal, kind: "delta" | "count" = "delta") => {
    if (!productId) return;
    if (!at || !Number.isFinite(Date.parse(at))) return;
    const eventTime = at;
    const dateOnlyCount = kind === "count" && /^\d{4}-\d{2}-\d{2}$/.test(eventTime);
    const countedAt = dateOnlyCount ? `${eventTime}T23:59:59.999Z` : eventTime;
    if (dateOnlyCount ? eventTime > now.toISOString().slice(0, 10) : Date.parse(countedAt) > now.getTime()) return;
    stockEvents.push({ productId, warehouse, at: countedAt, ...(kind === "count" ? { actual: value } : { delta: value }) });
  };

  for (const receipt of input.receipts) stockEvent(receipt.productId, "seller", receipt.receivedAt ?? now.toISOString(), d(receipt.quantity));
  for (const supply of input.supplies) {
    const suppliedAt = supply.suppliedAt ?? now.toISOString();
    stockEvent(supply.productId, "seller", suppliedAt, d(supply.quantity).negated());
    stockEvent(supply.productId, "ozon", suppliedAt, d(supply.quantity));
  }

  const soldQuantityByPostingProduct = new Map<string, Decimal>();
  for (const posting of input.postings) {
    if (!mappablePostingIds.has(posting.id)) continue;
    for (const item of input.postingItems.filter((candidate) => candidate.postingId === posting.id)) {
      if (item.movementEnabled === false || !isAccountableItem(item)) continue;
      const saleAt = posting.deliveredAt ?? (isMarketplaceBuyoutItem(posting, item) ? item.marketplaceBuyoutAt ?? posting.marketplaceBuyoutAt : null);
      if (!saleAt || !isEffectiveAt(saleAt, now)) continue;
      stockEvent(item.productId, "ozon", saleAt, d(item.quantity).negated());
      const key = `${posting.id}:${item.productId}`;
      soldQuantityByPostingProduct.set(key, (soldQuantityByPostingProduct.get(key) ?? new Decimal(0)).plus(d(item.quantity)));
    }
  }

  const returnedQuantityByPostingProduct = new Map<string, Decimal>();
  const profitReconciliationIssues: AccountingResult["profitReconciliationIssues"] = [];
  for (const returned of input.returns) {
    if (!returned.productId || returned.destination !== "seller") continue;
    const restockedAt = returned.receivedBySellerAt;
    if (!restockedAt || !isEffectiveAt(restockedAt, now)) continue;
    if (!returned.postingId) {
      stockEvent(returned.productId, returned.destination, restockedAt, d(returned.quantity));
      const product = productById.get(returned.productId);
      profitReconciliationIssues.push({
        externalId: returned.externalId ?? "",
        productId: returned.productId,
        sku: product?.sku ?? "",
      });
      continue;
    }
    const key = `${returned.postingId}:${returned.productId}`;
    const sold = soldQuantityByPostingProduct.get(key) ?? new Decimal(0);
    const alreadyRestocked = returnedQuantityByPostingProduct.get(key) ?? new Decimal(0);
    const acceptedQuantity = Decimal.min(d(returned.quantity), Decimal.max(0, sold.minus(alreadyRestocked)));
    if (acceptedQuantity.lt(d(returned.quantity))) {
      const product = productById.get(returned.productId);
      profitReconciliationIssues.push({
        externalId: returned.externalId ?? "",
        productId: returned.productId,
        sku: product?.sku ?? "",
      });
    }
    if (!acceptedQuantity.gt(0)) continue;
    stockEvent(returned.productId, "seller", restockedAt, acceptedQuantity);
    returnedQuantityByPostingProduct.set(key, alreadyRestocked.plus(acceptedQuantity));
  }

  for (const writeoff of input.manualWriteoffs) stockEvent(writeoff.productId, "seller", writeoff.writtenOffAt ?? now.toISOString(), d(writeoff.quantity).negated());
  for (const writeoff of input.ozonWriteoffs) {
    if (writeoff.occurredAt) stockEvent(writeoff.productId, "ozon", writeoff.occurredAt, d(writeoff.quantity).negated());
  }
  for (const adjustment of input.stockAdjustments) stockEvent(adjustment.productId, adjustment.warehouse, adjustment.countedAt, d(adjustment.actualQuantity), "count");

  stockEvents.sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || Number("actual" in left) - Number("actual" in right));
  for (const event of stockEvents) {
    const map = event.warehouse === "seller" ? sellerStock : ozonStock;
    if ("actual" in event) map.set(event.productId, event.actual ?? new Decimal(0));
    else if (event.delta) add(map, event.productId, event.delta);
  }

  let soldPurchaseCost = new Decimal(0);
  let soldSharedCosts = new Decimal(0);
  const previewPostingIds = new Set<string>();
  let previewGross = new Decimal(0);
  let previewProfit = new Decimal(0);
  let preliminaryCostIssue = false;
  const costingIssues = new Map<string, { productId: string; sku: string; title: string }>();
  const recordMissingCost = (productId: string) => {
    const product = productById.get(productId);
    costingIssues.set(productId, { productId, sku: product?.sku ?? "", title: product?.title ?? "Товар" });
  };
  for (const posting of input.postings) {
    if (!mappablePostingIds.has(posting.id)) continue;
    const items = input.postingItems.filter((candidate) => candidate.postingId === posting.id && isAccountableItem(candidate));
    const recognizedQuantityByProduct = new Map<string, Decimal>();
    for (const item of items) {
      if (item.movementEnabled === false) continue;
      if (isRecognizedItem(posting, item, now)) {
        recognizedQuantityByProduct.set(item.productId!, (recognizedQuantityByProduct.get(item.productId!) ?? new Decimal(0)).plus(d(item.quantity)));
      } else if (isDelivered(posting, now) && !isMarketplaceBuyoutItem(posting, item)) {
        previewPostingIds.add(posting.id);
        const quantity = d(item.quantity);
        const gross = quantity.times(d(item.price));
        previewGross = previewGross.plus(gross);
        const landedCost = landedByProduct.get(item.productId!);
        if (quantity.gt(0) && landedCost === undefined) {
          recordMissingCost(item.productId!);
          preliminaryCostIssue = true;
        }
        previewProfit = previewProfit.plus(gross.minus(quantity.times(landedCost ?? 0)));
      }
    }
    for (const [productId, quantity] of recognizedQuantityByProduct) {
      const returned = returnedQuantityByPostingProduct.get(`${posting.id}:${productId}`) ?? new Decimal(0);
      const soldQuantity = Decimal.max(0, quantity.minus(returned));
      if (soldQuantity.gt(0) && !averageByProduct.has(productId)) recordMissingCost(productId);
      const averageCost = averageByProduct.get(productId) ?? new Decimal(0);
      const landedCost = landedByProduct.get(productId) ?? new Decimal(0);
      soldPurchaseCost = soldPurchaseCost.plus(soldQuantity.times(averageCost));
      soldSharedCosts = soldSharedCosts.plus(soldQuantity.times(landedCost.minus(averageCost)));
    }
  }

  let manualLossPurchaseCost = new Decimal(0);
  let manualLossSharedCosts = new Decimal(0);
  for (const writeoff of input.manualWriteoffs) {
    if (!isEffectiveAt(writeoff.writtenOffAt, now)) continue;
    const quantity = d(writeoff.quantity);
    if (quantity.gt(0) && !averageByProduct.has(writeoff.productId)) recordMissingCost(writeoff.productId);
    const averageCost = averageByProduct.get(writeoff.productId) ?? new Decimal(0);
    const landedCost = landedByProduct.get(writeoff.productId) ?? new Decimal(0);
    manualLossPurchaseCost = manualLossPurchaseCost.plus(quantity.times(averageCost));
    manualLossSharedCosts = manualLossSharedCosts.plus(quantity.times(landedCost.minus(averageCost)));
  }

  let ozonWriteoffPurchaseCost = new Decimal(0);
  let ozonWriteoffSharedCosts = new Decimal(0);
  for (const writeoff of input.ozonWriteoffs) {
    if (!writeoff.productId || !writeoff.occurredAt || !isEffectiveAt(writeoff.occurredAt, now)) continue;
    const quantity = d(writeoff.quantity);
    if (quantity.gt(0) && !averageByProduct.has(writeoff.productId)) recordMissingCost(writeoff.productId);
    const averageCost = averageByProduct.get(writeoff.productId) ?? new Decimal(0);
    const landedCost = landedByProduct.get(writeoff.productId) ?? new Decimal(0);
    ozonWriteoffPurchaseCost = ozonWriteoffPurchaseCost.plus(quantity.times(averageCost));
    ozonWriteoffSharedCosts = ozonWriteoffSharedCosts.plus(quantity.times(landedCost.minus(averageCost)));
  }

  const orderFinance = input.financeAccruals.filter((accrual) => {
    const category = accrual.category?.toUpperCase();
    if (accrual.isOzonWriteoffCompensation) return true;
    return accrual.postingId !== null
      && postingById.has(accrual.postingId)
      && (!category || category === "POSTING" || category === "ITEM");
  });
  const recognizedFinance = orderFinance.filter((accrual) => {
    const posting = accrual.postingId ? postingById.get(accrual.postingId) : undefined;
    if (!posting && !accrual.isOzonWriteoffCompensation) return false;
    if (!isEffectiveAt(accrual.accrualDate, now)) return false;
    if (accrual.ignored) return false;
    if (accrual.isOzonWriteoffCompensation) return true;
    if (!posting) return false;
    const category = accrual.category?.toUpperCase();
    if (!mappablePostingIds.has(posting.id)) return false;
    if (category === "ITEM") {
      const candidates = input.postingItems.filter((item) =>
        item.postingId === posting.id &&
        (accrual.ozonSku ? item.ozonSku === accrual.ozonSku : item.productId === accrual.productId),
      );
      if (!candidates.length || candidates.some((item) => !isAccountableItem(item))) return false;
      if (isCancelled(posting)) return true;
      return candidates.every((item) => isRecognizedItem(posting, item, now));
    }
    if (isCancelled(posting)) return true;
    return recognizedPostings.has(posting.id);
  });
  const ignoredFinance = orderFinance.filter((accrual) => !recognizedFinance.includes(accrual));
  const recognizedFinanceAmount = sum(recognizedFinance.map((accrual) => d(accrual.amount)));
  const recognizedOzonWriteoffCompensation = sum(recognizedFinance
    .filter((accrual) => accrual.isOzonWriteoffCompensation)
    .map((accrual) => d(accrual.amount)));
  const recognizedOzonOther = recognizedFinanceAmount.minus(recognizedOzonWriteoffCompensation);
  const unrecognizedFinanceAmount = sum(ignoredFinance.map((accrual) => d(accrual.amount)));

  const cashOutflow = sum([
    ...input.purchases.map((purchase) => d(purchase.amountPaid)),
    ...input.expenses.filter((expense) => isEffectiveAt(expense.spentAt, now)).map((expense) => d(expense.amount)),
    ...input.supplies.filter((supply) => isEffectiveAt(supply.suppliedAt, now)).map((supply) => d(supply.shippingCost)),
  ]);
  const cashBalance = recognizedFinanceAmount.minus(cashOutflow);
  const calculatedProfit = recognizedFinanceAmount
    .minus(soldPurchaseCost)
    .minus(soldSharedCosts)
    .minus(manualLossPurchaseCost)
    .minus(manualLossSharedCosts)
    .minus(ozonWriteoffPurchaseCost)
    .minus(ozonWriteoffSharedCosts);
  const confirmedProfit = costingIssues.size || profitReconciliationIssues.length ? null : calculatedProfit;
  const purchaseCashOutflow = sum(input.purchases.map((purchase) => d(purchase.amountPaid)));
  const expenseCashOutflow = sum(input.expenses.filter((expense) => isEffectiveAt(expense.spentAt, now)).map((expense) => d(expense.amount)));
  const supplyShippingOutflow = sum(input.supplies.filter((supply) => isEffectiveAt(supply.suppliedAt, now)).map((supply) => d(supply.shippingCost)));

  const products = input.products.map((product) => {
    const average = averageByProduct.get(product.id);
    const landed = landedByProduct.get(product.id);
    return {
      productId: product.id,
      sku: product.sku,
      title: product.title,
      receivedQuantity: units(receivedByProduct.get(product.id) ?? new Decimal(0)),
      averagePurchaseCost: average ? money(average) : null,
      landedUnitCost: landed ? money(landed) : null,
      sellerStock: units(sellerStock.get(product.id) ?? new Decimal(0)),
      ozonStock: units(ozonStock.get(product.id) ?? new Decimal(0)),
    };
  });

  const reconciliationErrors = products.flatMap((product) => {
    const errors: AccountingResult["reconciliationErrors"] = [];
    const seller = d(product.sellerStock);
    const ozon = d(product.ozonStock);
    if (seller.lt(0)) errors.push({ productId: product.productId, sku: product.sku, warehouse: "seller", quantity: product.sellerStock });
    if (ozon.lt(0)) errors.push({ productId: product.productId, sku: product.sku, warehouse: "ozon", quantity: product.ozonStock });
    return errors;
  });

  return {
    cashBalance: money(cashBalance),
    confirmedProfit: confirmedProfit === null ? null : money(confirmedProfit),
    cashBreakdown: {
      recognizedOzon: money(recognizedFinanceAmount),
      recognizedOzonOther: money(recognizedOzonOther),
      ozonWriteoffCompensation: money(recognizedOzonWriteoffCompensation),
      purchases: money(purchaseCashOutflow.negated()),
      expenses: money(expenseCashOutflow.negated()),
      supplyShipping: money(supplyShippingOutflow.negated()),
      total: money(cashBalance),
    },
    profitBreakdown: {
      recognizedOzon: money(recognizedFinanceAmount),
      recognizedOzonOther: money(recognizedOzonOther),
      ozonWriteoffCompensation: money(recognizedOzonWriteoffCompensation),
      soldPurchaseCost: money(soldPurchaseCost.negated()),
      soldSharedCosts: money(soldSharedCosts.negated()),
      manualLossPurchaseCost: money(manualLossPurchaseCost.negated()),
      manualLossSharedCosts: money(manualLossSharedCosts.negated()),
      ozonWriteoffPurchaseCost: money(ozonWriteoffPurchaseCost.negated()),
      ozonWriteoffSharedCosts: money(ozonWriteoffSharedCosts.negated()),
      total: confirmedProfit === null ? null : money(confirmedProfit),
    },
    sharedExpenseCoefficient: sharedExpenseCoefficient.toDecimalPlaces(4).toFixed(4),
    receivedPurchaseValue: money(receivedPurchaseValue),
    sharedExpenses: money(sharedExpenses),
    preliminaryOrders: { count: previewPostingIds.size, grossAmount: money(previewGross), expectedProfit: preliminaryCostIssue ? null : money(previewProfit) },
    products,
    costingIssues: [...costingIssues.values()],
    reconciliationErrors,
    profitReconciliationIssues,
    recognizedPostingIds: [...recognizedPostings],
    unrecognizedFinanceAmount: money(unrecognizedFinanceAmount),
  };
}
