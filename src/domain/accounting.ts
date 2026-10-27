import Decimal from "decimal.js";

Decimal.set({ precision: 24, rounding: Decimal.ROUND_HALF_UP });

export type AccountingInput = {
  products: { id: string; sku: string; title: string }[];
  purchases: { id: string; amountPaid: string | number; sourceLabel?: string }[];
  receipts: { productId: string; quantity: string | number; unitCost: string | number; includeInAverageCost?: boolean; receivedAt?: string }[];
  supplies: { productId: string; quantity: string | number; shippingCost: string | number; suppliedAt?: string }[];
  expenses: { amount: string | number; spentAt?: string; sourceLabel?: string }[];
  ozonSharedExpenses?: { amount: string | number; spentAt?: string }[];
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
  financeAccruals: { postingId: string | null; productId?: string | null; ozonSku?: string | null; amount: string | number; category?: string; accrualDate?: string; isOzonWriteoffCompensation?: boolean; ignored?: boolean; sourceGroup?: "orders" | "shared" | "compensation"; sourceLabel?: string }[];
  returns: {
    externalId?: string;
    postingId: string | null;
    productId: string | null;
    quantity: string | number;
    destination: "seller" | "ozon" | "unknown";
    returnedAt?: string | null;
    receivedBySellerAt: string | null;
    writtenOffAt?: string | null;
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
  landedUnitCostExact: string | null;
  sellerStock: string;
  ozonStock: string;
  successfulDeliveryQuantity: string;
  attemptedDeliveryQuantity: string;
  deliverySuccessPercent: string | null;
  soldQuantity: string;
  profitPerUnit: string | null;
  marginPercent: string | null;
  financeCoveragePercent: string | null;
  financeCoveredPostings: string;
  financeRelevantPostings: string;
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
    ozonSharedExpenses: string;
    supplyShipping: string;
    total: string;
  };
  cashFlow: {
    inflows: { source: string; amount: string }[];
    outflows: { source: string; amount: string }[];
    totalIncome: string;
    totalExpenses: string;
    total: string;
    pendingOzon: { count: number; income: string; expenses: string };
  };
  profitBreakdown: {
    recognizedOzon: string;
    recognizedOzonOther: string;
    orderProfit: string;
    ozonWriteoffCompensation: string;
    soldPurchaseCost: string;
    soldSharedCosts: string;
    soldMySharedCosts: string;
    soldOzonSharedCosts: string;
    sharedExpenseCoefficient: string;
    manualLossPurchaseCost: string;
    manualLossSharedCosts: string;
    ozonWriteoffPurchaseCost: string;
    ozonWriteoffSharedCosts: string;
    total: string | null;
  };
  sharedExpenseCoefficient: string;
  receivedPurchaseValue: string;
  sharedExpenses: string;
  mySharedExpenses: string;
  ozonSharedExpenses: string;
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

function isDeliveredStatus(posting: PostingInput) {
  const status = posting.status.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return status === "delivered" || /^доставлен[аоы]?$/.test(status);
}

function isNominallySoldItem(posting: PostingInput, item: PostingItemInput, now: Date) {
  if (item.movementEnabled === false || isCancelled(posting) || !isDeliveredStatus(posting)) return false;
  if (isMarketplaceBuyoutItem(posting, item)) {
    const buyoutAt = item.marketplaceBuyoutAt ?? (posting.isMarketplaceBuyout ? posting.marketplaceBuyoutAt : null);
    return Boolean(buyoutAt) && Date.parse(buyoutAt!) <= now.getTime();
  }
  return isDelivered(posting, now);
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
  const costedQuantityByProduct = new Map<string, Decimal>();
  const receivedValueByProduct = new Map<string, Decimal>();
  for (const receipt of input.receipts) {
    if (!isEffectiveAt(receipt.receivedAt, now)) continue;
    const receivedQty = d(receipt.quantity);
    receivedByProduct.set(receipt.productId, (receivedByProduct.get(receipt.productId) ?? new Decimal(0)).plus(receivedQty));
    if (receipt.includeInAverageCost === false) continue;
    costedQuantityByProduct.set(receipt.productId, (costedQuantityByProduct.get(receipt.productId) ?? new Decimal(0)).plus(receivedQty));
    const purchaseValue = receivedQty.times(d(receipt.unitCost));
    receivedValueByProduct.set(receipt.productId, (receivedValueByProduct.get(receipt.productId) ?? new Decimal(0)).plus(purchaseValue));
  }

  const receivedPurchaseValue = sum([...receivedValueByProduct.values()]);
  const mySharedExpenses = sum(input.expenses
    .filter((expense) => isEffectiveAt(expense.spentAt, now))
    .map((expense) => d(expense.amount)));
  const ozonSharedFinanceAmount = sum((input.ozonSharedExpenses ?? [])
    .filter((expense) => isEffectiveAt(expense.spentAt, now))
    .map((expense) => d(expense.amount)));
  const ozonSharedExpenses = ozonSharedFinanceAmount.negated();
  const sharedExpenses = mySharedExpenses.plus(ozonSharedExpenses);
  const sharedExpenseCoefficient = receivedPurchaseValue.isZero()
    ? new Decimal(0)
    : sharedExpenses.div(receivedPurchaseValue);
  const mySharedExpenseCoefficient = receivedPurchaseValue.isZero()
    ? new Decimal(0)
    : mySharedExpenses.div(receivedPurchaseValue);
  const ozonSharedExpenseCoefficient = receivedPurchaseValue.isZero()
    ? new Decimal(0)
    : ozonSharedExpenses.div(receivedPurchaseValue);

  const averageByProduct = new Map<string, Decimal>();
  const landedByProduct = new Map<string, Decimal>();
  for (const product of input.products) {
    const qty = costedQuantityByProduct.get(product.id) ?? new Decimal(0);
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
    const restockWarehouse = returned.destination === "seller" || returned.destination === "ozon" ? returned.destination : null;
    const restockedAt = returned.destination === "seller" ? returned.receivedBySellerAt
      : returned.destination === "ozon" ? returned.availableAtOzon : null;
    if (returned.writtenOffAt && isEffectiveAt(returned.writtenOffAt, now)) {
      if (returned.productId && restockWarehouse && restockedAt && isEffectiveAt(restockedAt, now) && Date.parse(restockedAt) <= Date.parse(returned.writtenOffAt)) {
        stockEvent(returned.productId, restockWarehouse, restockedAt, d(returned.quantity));
        stockEvent(returned.productId, restockWarehouse, returned.writtenOffAt, d(returned.quantity).negated());
      }
      continue;
    }
    if (!returned.productId || !restockWarehouse) continue;
    if (!restockedAt || !isEffectiveAt(restockedAt, now)) continue;
    if (!returned.postingId) {
      stockEvent(returned.productId, restockWarehouse, restockedAt, d(returned.quantity));
      const product = productById.get(returned.productId);
      profitReconciliationIssues.push({
        externalId: returned.externalId ?? "",
        productId: returned.productId,
        sku: product?.sku ?? "",
      });
      continue;
    }
    const returnPosting = postingById.get(returned.postingId);
    if (returnPosting && isCancelled(returnPosting)) {
      if (restockWarehouse === "seller") stockEvent(returned.productId, "seller", restockedAt, d(returned.quantity));
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
    stockEvent(returned.productId, restockWarehouse, restockedAt, acceptedQuantity);
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
  let soldMySharedCosts = new Decimal(0);
  let soldOzonSharedCosts = new Decimal(0);
  let nominalSoldPurchaseCost = new Decimal(0);
  let nominalSoldSharedCosts = new Decimal(0);
  const postedQuantityByPostingProduct = new Map<string, Decimal>();
  const recognizedQuantityByPostingProduct = new Map<string, Decimal>();
  const nominalQuantityByPostingProduct = new Map<string, Decimal>();
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
    const nominalQuantityByProduct = new Map<string, Decimal>();
    for (const item of items) {
      if (item.movementEnabled === false) continue;
      const key = `${posting.id}:${item.productId}`;
      postedQuantityByPostingProduct.set(key, (postedQuantityByPostingProduct.get(key) ?? new Decimal(0)).plus(d(item.quantity)));
      if (isNominallySoldItem(posting, item, now)) {
        nominalQuantityByProduct.set(item.productId!, (nominalQuantityByProduct.get(item.productId!) ?? new Decimal(0)).plus(d(item.quantity)));
        nominalQuantityByPostingProduct.set(key, (nominalQuantityByPostingProduct.get(key) ?? new Decimal(0)).plus(d(item.quantity)));
      }
      if (isRecognizedItem(posting, item, now)) {
        recognizedQuantityByProduct.set(item.productId!, (recognizedQuantityByProduct.get(item.productId!) ?? new Decimal(0)).plus(d(item.quantity)));
        recognizedQuantityByPostingProduct.set(key, (recognizedQuantityByPostingProduct.get(key) ?? new Decimal(0)).plus(d(item.quantity)));
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
      soldMySharedCosts = soldMySharedCosts.plus(soldQuantity.times(averageCost).times(mySharedExpenseCoefficient));
      soldOzonSharedCosts = soldOzonSharedCosts.plus(soldQuantity.times(averageCost).times(ozonSharedExpenseCoefficient));
    }
    for (const [productId, quantity] of nominalQuantityByProduct) {
      const returned = returnedQuantityByPostingProduct.get(`${posting.id}:${productId}`) ?? new Decimal(0);
      const soldQuantity = Decimal.max(0, quantity.minus(returned));
      const averageCost = averageByProduct.get(productId) ?? new Decimal(0);
      const landedCost = landedByProduct.get(productId) ?? new Decimal(0);
      nominalSoldPurchaseCost = nominalSoldPurchaseCost.plus(soldQuantity.times(averageCost));
      nominalSoldSharedCosts = nominalSoldSharedCosts.plus(soldQuantity.times(landedCost.minus(averageCost)));
    }
  }

  let manualLossPurchaseCost = new Decimal(0);
  let manualLossSharedCosts = new Decimal(0);
  let nominalReturnWriteoffCost = new Decimal(0);
  const linkedReturnWriteoffs = new Map<string, { postingId: string; productId: string; quantity: Decimal }>();
  for (const writeoff of input.manualWriteoffs) {
    if (!isEffectiveAt(writeoff.writtenOffAt, now)) continue;
    const quantity = d(writeoff.quantity);
    if (quantity.gt(0) && !averageByProduct.has(writeoff.productId)) recordMissingCost(writeoff.productId);
    const averageCost = averageByProduct.get(writeoff.productId) ?? new Decimal(0);
    const landedCost = landedByProduct.get(writeoff.productId) ?? new Decimal(0);
    manualLossPurchaseCost = manualLossPurchaseCost.plus(quantity.times(averageCost));
    manualLossSharedCosts = manualLossSharedCosts.plus(quantity.times(landedCost.minus(averageCost)));
  }
  for (const returned of input.returns) {
    if (!returned.writtenOffAt || !isEffectiveAt(returned.writtenOffAt, now) || !returned.productId) continue;
    const quantity = d(returned.quantity);
    if (!quantity.gt(0)) continue;
    if (returned.postingId && postedQuantityByPostingProduct.has(`${returned.postingId}:${returned.productId}`)) {
      const key = `${returned.postingId}:${returned.productId}`;
      const existing = linkedReturnWriteoffs.get(key);
      linkedReturnWriteoffs.set(key, {
        postingId: returned.postingId,
        productId: returned.productId,
        quantity: (existing?.quantity ?? new Decimal(0)).plus(quantity),
      });
      continue;
    }
    if (returned.postingId) {
      const product = productById.get(returned.productId);
      profitReconciliationIssues.push({ externalId: returned.externalId ?? "", productId: returned.productId, sku: product?.sku ?? "" });
    }
    if (!averageByProduct.has(returned.productId)) recordMissingCost(returned.productId);
    const averageCost = averageByProduct.get(returned.productId) ?? new Decimal(0);
    const landedCost = landedByProduct.get(returned.productId) ?? new Decimal(0);
    manualLossPurchaseCost = manualLossPurchaseCost.plus(quantity.times(averageCost));
    manualLossSharedCosts = manualLossSharedCosts.plus(quantity.times(landedCost.minus(averageCost)));
  }
  for (const { postingId, productId, quantity } of linkedReturnWriteoffs.values()) {
    const key = `${postingId}:${productId}`;
    const postedQuantity = postedQuantityByPostingProduct.get(key) ?? new Decimal(0);
    const writeoffQuantity = Decimal.min(quantity, postedQuantity);
    if (quantity.gt(postedQuantity)) {
      const product = productById.get(productId);
      profitReconciliationIssues.push({
        externalId: input.returns.find((returned) => returned.postingId === postingId && returned.productId === productId)?.externalId ?? "",
        productId,
        sku: product?.sku ?? "",
      });
    }
    const recognizedSoldQuantity = Decimal.max(
      0,
      (recognizedQuantityByPostingProduct.get(key) ?? new Decimal(0)).minus(returnedQuantityByPostingProduct.get(key) ?? new Decimal(0)),
    );
    const confirmedLossQuantity = Decimal.max(0, writeoffQuantity.minus(Decimal.min(writeoffQuantity, recognizedSoldQuantity)));
    const nominalSoldQuantity = Decimal.max(
      0,
      (nominalQuantityByPostingProduct.get(key) ?? new Decimal(0)).minus(returnedQuantityByPostingProduct.get(key) ?? new Decimal(0)),
    );
    const nominalLossQuantity = Decimal.max(0, writeoffQuantity.minus(Decimal.min(writeoffQuantity, nominalSoldQuantity)));
    const averageCost = averageByProduct.get(productId) ?? new Decimal(0);
    const landedCost = landedByProduct.get(productId) ?? new Decimal(0);
    if ((confirmedLossQuantity.gt(0) || nominalLossQuantity.gt(0)) && !averageByProduct.has(productId)) recordMissingCost(productId);
    manualLossPurchaseCost = manualLossPurchaseCost.plus(confirmedLossQuantity.times(averageCost));
    manualLossSharedCosts = manualLossSharedCosts.plus(confirmedLossQuantity.times(landedCost.minus(averageCost)));
    nominalReturnWriteoffCost = nominalReturnWriteoffCost.plus(nominalLossQuantity.times(landedCost));
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
      && (!category || category === "POSTING" || category === "ITEM" || category === "NON_ITEM");
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
  const nominallyCompletePostingIds = new Set(input.postings.filter((posting) => {
    if (!mappablePostingIds.has(posting.id)) return false;
    if (isCancelled(posting)) return true;
    const items = input.postingItems.filter((item) => item.postingId === posting.id && isAccountableItem(item));
    return items.length > 0 && items.every((item) => isNominallySoldItem(posting, item, now));
  }).map((posting) => posting.id));
  const nominalOrderFinance = orderFinance.filter((accrual) => {
    if (accrual.isOzonWriteoffCompensation || accrual.ignored || !isEffectiveAt(accrual.accrualDate, now)) return false;
    const posting = accrual.postingId ? postingById.get(accrual.postingId) : undefined;
    if (!posting || !mappablePostingIds.has(posting.id)) return false;
    if (isCancelled(posting)) return true;
    if (accrual.category?.toUpperCase() === "ITEM") {
      const candidates = input.postingItems.filter((item) =>
        item.postingId === posting.id &&
        (accrual.ozonSku ? item.ozonSku === accrual.ozonSku : item.productId === accrual.productId),
      );
      return candidates.length > 0 && candidates.every((item) => isAccountableItem(item) && isNominallySoldItem(posting, item, now));
    }
    return nominallyCompletePostingIds.has(posting.id);
  });
  const isOrderAccrual = (accrual: AccountingInput["financeAccruals"][number]) => accrual.sourceGroup === "orders"
    || (!accrual.sourceGroup && orderFinance.includes(accrual) && !accrual.isOzonWriteoffCompensation);
  const pendingOrderFinance = input.financeAccruals.filter((accrual) =>
    isOrderAccrual(accrual) && !recognizedFinance.includes(accrual) && isEffectiveAt(accrual.accrualDate, now),
  );
  const recognizedFinanceAmount = sum(recognizedFinance.map((accrual) => d(accrual.amount)));
  const recognizedOzonWriteoffCompensation = sum(recognizedFinance
    .filter((accrual) => accrual.isOzonWriteoffCompensation)
    .map((accrual) => d(accrual.amount)));
  const recognizedOzonOther = recognizedFinanceAmount.minus(recognizedOzonWriteoffCompensation);
  const nominalOrderFinanceAmount = sum(nominalOrderFinance.map((accrual) => d(accrual.amount)));
  const orderProfit = nominalOrderFinanceAmount.minus(nominalSoldPurchaseCost).minus(nominalSoldSharedCosts).minus(nominalReturnWriteoffCost);
  const unrecognizedFinanceAmount = sum(pendingOrderFinance.map((accrual) => d(accrual.amount)));

  const productSales = new Map<string, {
    attempted: Decimal;
    delivered: Decimal;
    sold: Decimal;
    revenue: Decimal;
    relevantPostingIds: Set<string>;
    soldByPosting: Map<string, Decimal>;
    revenueByPosting: Map<string, Decimal>;
    financeByPosting: Map<string, Decimal>;
  }>();
  const salesFor = (productId: string) => {
    const current = productSales.get(productId);
    if (current) return current;
    const created = {
      attempted: new Decimal(0), delivered: new Decimal(0), sold: new Decimal(0), revenue: new Decimal(0),
      relevantPostingIds: new Set<string>(), soldByPosting: new Map<string, Decimal>(), revenueByPosting: new Map<string, Decimal>(), financeByPosting: new Map<string, Decimal>(),
    };
    productSales.set(productId, created);
    return created;
  };
  const accountableItemsByPosting = new Map<string, PostingItemInput[]>();
  for (const item of input.postingItems) {
    if (item.movementEnabled === false || !isAccountableItem(item)) continue;
    accountableItemsByPosting.set(item.postingId, [...(accountableItemsByPosting.get(item.postingId) ?? []), item]);
  }
  for (const posting of input.postings) {
    const items = accountableItemsByPosting.get(posting.id) ?? [];
    for (const item of items) {
      const stats = salesFor(item.productId!);
      const quantity = d(item.quantity);
      const nominallySold = isNominallySoldItem(posting, item, now);
      const deliveryResolved = nominallySold || isCancelled(posting);
      if (deliveryResolved) {
        stats.attempted = stats.attempted.plus(quantity);
        stats.relevantPostingIds.add(posting.id);
      }
      if (!nominallySold) continue;
      stats.delivered = stats.delivered.plus(quantity);
      const returned = returnedQuantityByPostingProduct.get(`${posting.id}:${item.productId}`) ?? new Decimal(0);
      const sold = Decimal.max(0, quantity.minus(returned));
      stats.sold = stats.sold.plus(sold);
      stats.revenue = stats.revenue.plus(sold.times(d(item.price)));
      stats.soldByPosting.set(posting.id, (stats.soldByPosting.get(posting.id) ?? new Decimal(0)).plus(sold));
      stats.revenueByPosting.set(posting.id, (stats.revenueByPosting.get(posting.id) ?? new Decimal(0)).plus(sold.times(d(item.price))));
    }
  }

  const allocatePostingFinance = (postingId: string, amount: Decimal, sourceItems: PostingItemInput[]) => {
    const weightsByProduct = new Map<string, Decimal>();
    for (const item of sourceItems) {
      if (!item.productId) continue;
      const weight = Decimal.max(0, d(item.price).times(d(item.quantity)));
      weightsByProduct.set(item.productId, (weightsByProduct.get(item.productId) ?? new Decimal(0)).plus(weight));
    }
    if (![...weightsByProduct.values()].some((weight) => weight.gt(0))) {
      weightsByProduct.clear();
      for (const item of sourceItems) {
        if (!item.productId) continue;
        weightsByProduct.set(item.productId, (weightsByProduct.get(item.productId) ?? new Decimal(0)).plus(d(item.quantity)));
      }
    }
    const entries = [...weightsByProduct.entries()].filter(([, weight]) => weight.gt(0));
    if (!entries.length) return;
    const totalWeight = sum(entries.map(([, weight]) => weight));
    let remaining = amount;
    entries.forEach(([productId, weight], index) => {
      const allocation = index === entries.length - 1 ? remaining : amount.times(weight).div(totalWeight);
      remaining = remaining.minus(allocation);
      const stats = salesFor(productId);
      stats.financeByPosting.set(postingId, (stats.financeByPosting.get(postingId) ?? new Decimal(0)).plus(allocation));
    });
  };
  for (const accrual of nominalOrderFinance) {
    if (!accrual.postingId) continue;
    const items = accountableItemsByPosting.get(accrual.postingId) ?? [];
    const skuItems = accrual.ozonSku ? items.filter((item) => item.ozonSku === accrual.ozonSku) : [];
    const productItems = accrual.productId ? items.filter((item) => item.productId === accrual.productId) : [];
    const exactItems = skuItems.length ? skuItems : productItems;
    if (exactItems.length) {
      allocatePostingFinance(accrual.postingId, d(accrual.amount), exactItems);
      continue;
    }
    const deliveredItems = items.filter((item) => {
      const posting = postingById.get(item.postingId);
      return posting ? isNominallySoldItem(posting, item, now) : false;
    });
    allocatePostingFinance(accrual.postingId, d(accrual.amount), deliveredItems.length ? deliveredItems : items);
  }

  const inflowsBySource = new Map<string, Decimal>();
  const outflowsBySource = new Map<string, Decimal>();
  const addCashMovement = (source: string, amount: Decimal) => {
    if (amount.gt(0)) inflowsBySource.set(source, (inflowsBySource.get(source) ?? new Decimal(0)).plus(amount));
    if (amount.lt(0)) outflowsBySource.set(source, (outflowsBySource.get(source) ?? new Decimal(0)).plus(amount.abs()));
  };
  for (const accrual of input.financeAccruals) {
    if (!isEffectiveAt(accrual.accrualDate, now)) continue;
    const isOrder = isOrderAccrual(accrual);
    const groupLabel = accrual.sourceGroup === "compensation" || accrual.isOzonWriteoffCompensation
      ? "Компенсации Ozon за списания"
      : isOrder ? "Операции по заказам Ozon" : "Общие операции Ozon";
    addCashMovement(groupLabel, d(accrual.amount));
  }
  for (const purchase of input.purchases) {
    addCashMovement("Закупки", d(purchase.amountPaid).negated());
  }
  for (const expense of input.expenses) {
    if (!isEffectiveAt(expense.spentAt, now)) continue;
    addCashMovement("Мои расходы", d(expense.amount).negated());
  }
  const totalIncome = sum([...inflowsBySource.values()]);
  const totalExpenses = sum([...outflowsBySource.values()]);
  const cashBalance = totalIncome.minus(totalExpenses);
  const effectiveFinanceRows = input.financeAccruals.filter((accrual) => isEffectiveAt(accrual.accrualDate, now));
  const allOzonFinanceAmount = sum(effectiveFinanceRows.map((accrual) => d(accrual.amount)));
  const ozonCompensationAmount = sum(effectiveFinanceRows
    .filter((accrual) => accrual.sourceGroup === "compensation" || accrual.isOzonWriteoffCompensation)
    .map((accrual) => d(accrual.amount)));
  const ozonOrderFinanceAmount = sum(effectiveFinanceRows
    .filter((accrual) => isOrderAccrual(accrual) && !accrual.isOzonWriteoffCompensation)
    .map((accrual) => d(accrual.amount)));
  const ozonSharedCashAmount = allOzonFinanceAmount.minus(ozonCompensationAmount).minus(ozonOrderFinanceAmount);
  const cashFlow = {
    inflows: [...inflowsBySource.entries()].sort((left, right) => right[1].cmp(left[1])).map(([source, amount]) => ({ source, amount: money(amount) })),
    outflows: [...outflowsBySource.entries()].sort((left, right) => right[1].cmp(left[1])).map(([source, amount]) => ({ source, amount: money(amount) })),
    totalIncome: money(totalIncome),
    totalExpenses: money(totalExpenses),
    total: money(cashBalance),
    pendingOzon: {
      count: pendingOrderFinance.length,
      income: money(sum(pendingOrderFinance.map((accrual) => Decimal.max(0, d(accrual.amount))))),
      expenses: money(sum(pendingOrderFinance.map((accrual) => Decimal.max(0, d(accrual.amount).negated())))),
    },
  };
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

  const products = input.products.map((product) => {
    const average = averageByProduct.get(product.id);
    const landed = landedByProduct.get(product.id);
    const sales = productSales.get(product.id);
    const soldQuantity = sales?.sold ?? new Decimal(0);
    const financePostingIds = sales
      ? [...sales.relevantPostingIds].filter((postingId) => sales.financeByPosting.has(postingId))
      : [];
    const coveredSoldQuantity = sum(financePostingIds.map((postingId) => sales?.soldByPosting.get(postingId) ?? new Decimal(0)));
    const coveredRevenue = sum(financePostingIds.map((postingId) => sales?.revenueByPosting.get(postingId) ?? new Decimal(0)));
    const coveredFinance = sum(financePostingIds.map((postingId) => sales?.financeByPosting.get(postingId) ?? new Decimal(0)));
    const productProfit = sales && landed !== undefined && coveredSoldQuantity.gt(0)
      ? coveredFinance.minus(coveredSoldQuantity.times(landed))
      : null;
    return {
      productId: product.id,
      sku: product.sku,
      title: product.title,
      receivedQuantity: units(receivedByProduct.get(product.id) ?? new Decimal(0)),
      averagePurchaseCost: average ? money(average) : null,
      landedUnitCost: landed ? money(landed) : null,
      landedUnitCostExact: landed?.toString() ?? null,
      sellerStock: units(sellerStock.get(product.id) ?? new Decimal(0)),
      ozonStock: units(ozonStock.get(product.id) ?? new Decimal(0)),
      successfulDeliveryQuantity: units(sales?.delivered ?? new Decimal(0)),
      attemptedDeliveryQuantity: units(sales?.attempted ?? new Decimal(0)),
      deliverySuccessPercent: sales?.attempted.gt(0) ? sales.delivered.div(sales.attempted).times(100).toDecimalPlaces(2).toFixed(2) : null,
      soldQuantity: units(soldQuantity),
      profitPerUnit: productProfit !== null ? money(productProfit.div(coveredSoldQuantity)) : null,
      marginPercent: productProfit !== null && coveredRevenue.gt(0) ? productProfit.div(coveredRevenue).times(100).toDecimalPlaces(2).toFixed(2) : null,
      financeCoveragePercent: sales?.relevantPostingIds.size
        ? new Decimal(financePostingIds.length).div(sales.relevantPostingIds.size).times(100).toDecimalPlaces(2).toFixed(2)
        : null,
      financeCoveredPostings: String(financePostingIds.length),
      financeRelevantPostings: String(sales?.relevantPostingIds.size ?? 0),
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
      recognizedOzon: money(allOzonFinanceAmount),
      recognizedOzonOther: money(ozonOrderFinanceAmount),
      ozonWriteoffCompensation: money(ozonCompensationAmount),
      purchases: money(purchaseCashOutflow.negated()),
      expenses: money(expenseCashOutflow.negated()),
      ozonSharedExpenses: money(ozonSharedCashAmount),
      supplyShipping: "0.00",
      total: money(cashBalance),
    },
    cashFlow,
    profitBreakdown: {
      recognizedOzon: money(recognizedFinanceAmount),
      recognizedOzonOther: money(recognizedOzonOther),
      orderProfit: money(orderProfit),
      ozonWriteoffCompensation: money(recognizedOzonWriteoffCompensation),
      soldPurchaseCost: money(soldPurchaseCost.negated()),
      soldSharedCosts: money(soldSharedCosts.negated()),
      soldMySharedCosts: money(soldMySharedCosts.negated()),
      soldOzonSharedCosts: money(soldOzonSharedCosts.negated()),
      sharedExpenseCoefficient: sharedExpenseCoefficient.toDecimalPlaces(6).toFixed(6),
      manualLossPurchaseCost: money(manualLossPurchaseCost.negated()),
      manualLossSharedCosts: money(manualLossSharedCosts.negated()),
      ozonWriteoffPurchaseCost: money(ozonWriteoffPurchaseCost.negated()),
      ozonWriteoffSharedCosts: money(ozonWriteoffSharedCosts.negated()),
      total: confirmedProfit === null ? null : money(confirmedProfit),
    },
    sharedExpenseCoefficient: sharedExpenseCoefficient.toDecimalPlaces(4).toFixed(4),
    receivedPurchaseValue: money(receivedPurchaseValue),
    sharedExpenses: money(sharedExpenses),
    mySharedExpenses: money(mySharedExpenses),
    ozonSharedExpenses: money(ozonSharedExpenses),
    preliminaryOrders: { count: previewPostingIds.size, grossAmount: money(previewGross), expectedProfit: preliminaryCostIssue ? null : money(previewProfit) },
    products,
    costingIssues: [...costingIssues.values()],
    reconciliationErrors,
    profitReconciliationIssues,
    recognizedPostingIds: [...recognizedPostings],
    unrecognizedFinanceAmount: money(unrecognizedFinanceAmount),
  };
}
