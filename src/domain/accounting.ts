import Decimal from "decimal.js";

Decimal.set({ precision: 24, rounding: Decimal.ROUND_HALF_UP });

export type AccountingInput = {
  products: { id: string; sku: string; title: string }[];
  purchases: { id: string; amountPaid: string | number }[];
  receipts: { productId: string; quantity: string | number; unitCost: string | number; receivedAt?: string }[];
  supplies: { productId: string; quantity: string | number; shippingCost: string | number; suppliedAt?: string }[];
  expenses: { amount: string | number }[];
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
  }[];
  financeAccruals: { postingId: string | null; productId?: string | null; amount: string | number; category?: string }[];
  returns: {
    postingId: string | null;
    productId: string | null;
    quantity: string | number;
    destination: "seller" | "ozon" | "unknown";
    returnedAt?: string | null;
    receivedBySellerAt: string | null;
    availableAtOzon: string | null;
  }[];
  manualWriteoffs: { productId: string; quantity: string | number; writtenOffAt?: string }[];
  ozonWriteoffs: { productId: string | null; quantity: string | number; occurredAt?: string | null }[];
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
  confirmedProfit: string;
  cashBreakdown: {
    recognizedOzon: string;
    purchases: string;
    expenses: string;
    supplyShipping: string;
    total: string;
  };
  profitBreakdown: {
    recognizedOzon: string;
    soldPurchaseCost: string;
    soldSharedCosts: string;
    manualLossPurchaseCost: string;
    manualLossSharedCosts: string;
    ozonWriteoffPurchaseCost: string;
    ozonWriteoffSharedCosts: string;
    total: string;
  };
  sharedExpenseCoefficient: string;
  receivedPurchaseValue: string;
  sharedExpenses: string;
  preliminaryOrders: { count: number; grossAmount: string; expectedProfit: string };
  products: ProductAccounting[];
  reconciliationErrors: { productId: string; sku: string; warehouse: "seller" | "ozon"; quantity: string }[];
  recognizedPostingIds: string[];
  unrecognizedFinanceAmount: string;
};

const d = (value: string | number | null | undefined) => new Decimal(value ?? 0);
const sum = (values: Decimal[]) => values.reduce((total, value) => total.plus(value), new Decimal(0));
const money = (value: Decimal) => value.toDecimalPlaces(2).toFixed(2);
const units = (value: Decimal) => value.toDecimalPlaces(3).toFixed(3);
const dayMs = 24 * 60 * 60 * 1000;

function isDelivered(posting: AccountingInput["postings"][number], asOf: Date) {
  return Boolean(posting.deliveredAt) && Date.parse(posting.deliveredAt!) <= asOf.getTime();
}

function isRecognized(posting: AccountingInput["postings"][number], now: Date) {
  if (posting.isMarketplaceBuyout) {
    return Boolean(posting.marketplaceBuyoutAt) && Date.parse(posting.marketplaceBuyoutAt!) <= now.getTime();
  }
  if (!isDelivered(posting, now)) return false;
  return now.getTime() >= new Date(posting.deliveredAt!).getTime() + 21 * dayMs;
}

function isAccountedSale(posting: AccountingInput["postings"][number], asOf: Date) {
  return isDelivered(posting, asOf) || posting.isMarketplaceBuyout;
}

function isCancelled(posting: AccountingInput["postings"][number]) {
  return /cancel|отмен|declin|reject/i.test(posting.status);
}

function hasCompleteProductMapping(posting: AccountingInput["postings"][number], items: AccountingInput["postingItems"]) {
  if (posting.accountingEnabled !== undefined) return posting.accountingEnabled;
  const postingItems = items.filter((item) => item.postingId === posting.id);
  return postingItems.length > 0 && postingItems.every((item) => item.productId !== null && !item.ignored);
}

export function calculateAccounting(input: AccountingInput, now = new Date()): AccountingResult {
  const productById = new Map(input.products.map((product) => [product.id, product]));
  const postingById = new Map(input.postings.map((posting) => [posting.id, posting]));
  const recognizedPostings = new Set(
    input.postings.filter((posting) => hasCompleteProductMapping(posting, input.postingItems) && isRecognized(posting, now)).map((posting) => posting.id),
  );
  const mappablePostingIds = new Set(
    input.postings.filter((posting) => hasCompleteProductMapping(posting, input.postingItems)).map((posting) => posting.id),
  );

  const receivedByProduct = new Map<string, Decimal>();
  const receivedValueByProduct = new Map<string, Decimal>();
  for (const receipt of input.receipts) {
    const receivedQty = d(receipt.quantity);
    receivedByProduct.set(receipt.productId, (receivedByProduct.get(receipt.productId) ?? new Decimal(0)).plus(receivedQty));
    const purchaseValue = receivedQty.times(d(receipt.unitCost));
    receivedValueByProduct.set(receipt.productId, (receivedValueByProduct.get(receipt.productId) ?? new Decimal(0)).plus(purchaseValue));
  }

  const receivedPurchaseValue = sum([...receivedValueByProduct.values()]);
  const sharedExpenses = sum([
    ...input.expenses.map((expense) => d(expense.amount)),
    ...input.supplies.map((supply) => d(supply.shippingCost)),
  ]);
  const sharedExpenseCoefficient = receivedPurchaseValue.isZero()
    ? new Decimal(0)
    : sharedExpenses.div(receivedPurchaseValue);

  const averageByProduct = new Map<string, Decimal>();
  const landedByProduct = new Map<string, Decimal>();
  for (const product of input.products) {
    const qty = receivedByProduct.get(product.id) ?? new Decimal(0);
    const value = receivedValueByProduct.get(product.id) ?? new Decimal(0);
    if (qty.gt(0)) {
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

  const returnedQuantityByPostingProduct = new Map<string, Decimal>();
  for (const posting of input.postings) {
    if (!mappablePostingIds.has(posting.id) || !isAccountedSale(posting, now)) continue;
    for (const item of input.postingItems.filter((candidate) => candidate.postingId === posting.id)) {
      if (item.movementEnabled === false) continue;
      stockEvent(item.productId, "ozon", posting.deliveredAt ?? posting.marketplaceBuyoutAt, d(item.quantity).negated());
    }
  }

  for (const returned of input.returns) {
    if (!returned.productId) continue;
    if (returned.destination === "unknown") continue;
    const restockedAt = returned.destination === "seller" ? returned.receivedBySellerAt : returned.availableAtOzon;
    if (!restockedAt) continue;
    stockEvent(returned.productId, returned.destination, restockedAt, d(returned.quantity));
    if (returned.postingId) {
      const key = `${returned.postingId}:${returned.productId}`;
      returnedQuantityByPostingProduct.set(key, (returnedQuantityByPostingProduct.get(key) ?? new Decimal(0)).plus(d(returned.quantity)));
    }
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
  let previewCount = 0;
  let previewGross = new Decimal(0);
  let previewProfit = new Decimal(0);
  for (const posting of input.postings) {
    if (!mappablePostingIds.has(posting.id) || !isAccountedSale(posting, now)) continue;
    const items = input.postingItems.filter((candidate) => candidate.postingId === posting.id && candidate.productId);
    if (isRecognized(posting, now)) {
      const quantityByProduct = new Map<string, Decimal>();
      for (const item of items) {
        if (item.movementEnabled === false) continue;
        quantityByProduct.set(item.productId!, (quantityByProduct.get(item.productId!) ?? new Decimal(0)).plus(d(item.quantity)));
      }
      for (const [productId, quantity] of quantityByProduct) {
        const returned = returnedQuantityByPostingProduct.get(`${posting.id}:${productId}`) ?? new Decimal(0);
        const soldQuantity = Decimal.max(0, quantity.minus(returned));
        const averageCost = averageByProduct.get(productId) ?? new Decimal(0);
        const landedCost = landedByProduct.get(productId) ?? new Decimal(0);
        soldPurchaseCost = soldPurchaseCost.plus(soldQuantity.times(averageCost));
        soldSharedCosts = soldSharedCosts.plus(soldQuantity.times(landedCost.minus(averageCost)));
      }
    } else if (isDelivered(posting, now) && !posting.isMarketplaceBuyout) {
      previewCount += 1;
      for (const item of items) {
        const quantity = d(item.quantity);
        const gross = quantity.times(d(item.price));
        previewGross = previewGross.plus(gross);
        previewProfit = previewProfit.plus(gross.minus(quantity.times(landedByProduct.get(item.productId!) ?? 0)));
      }
    }
  }

  let manualLossPurchaseCost = new Decimal(0);
  let manualLossSharedCosts = new Decimal(0);
  for (const writeoff of input.manualWriteoffs) {
    const quantity = d(writeoff.quantity);
    const averageCost = averageByProduct.get(writeoff.productId) ?? new Decimal(0);
    const landedCost = landedByProduct.get(writeoff.productId) ?? new Decimal(0);
    manualLossPurchaseCost = manualLossPurchaseCost.plus(quantity.times(averageCost));
    manualLossSharedCosts = manualLossSharedCosts.plus(quantity.times(landedCost.minus(averageCost)));
  }

  let ozonWriteoffPurchaseCost = new Decimal(0);
  let ozonWriteoffSharedCosts = new Decimal(0);
  for (const writeoff of input.ozonWriteoffs) {
    if (writeoff.productId) {
      const quantity = d(writeoff.quantity);
      const averageCost = averageByProduct.get(writeoff.productId) ?? new Decimal(0);
      const landedCost = landedByProduct.get(writeoff.productId) ?? new Decimal(0);
      ozonWriteoffPurchaseCost = ozonWriteoffPurchaseCost.plus(quantity.times(averageCost));
      ozonWriteoffSharedCosts = ozonWriteoffSharedCosts.plus(quantity.times(landedCost.minus(averageCost)));
    }
  }

  const recognizedFinance = input.financeAccruals.filter((accrual) => {
    const posting = accrual.postingId ? postingById.get(accrual.postingId) : undefined;
    if (posting) return mappablePostingIds.has(posting.id) && (recognizedPostings.has(posting.id) || isCancelled(posting));
    const category = accrual.category?.toUpperCase();
    if (category === "ITEM") return Boolean(accrual.productId);
    return category === "NON_ITEM" || category === "CONTAINER_FEES";
  });
  const ignoredFinance = input.financeAccruals.filter((accrual) => !recognizedFinance.includes(accrual));
  const recognizedFinanceAmount = sum(recognizedFinance.map((accrual) => d(accrual.amount)));
  const unrecognizedFinanceAmount = sum(ignoredFinance.map((accrual) => d(accrual.amount)));

  const cashOutflow = sum([
    ...input.purchases.map((purchase) => d(purchase.amountPaid)),
    ...input.expenses.map((expense) => d(expense.amount)),
    ...input.supplies.map((supply) => d(supply.shippingCost)),
  ]);
  const cashBalance = recognizedFinanceAmount.minus(cashOutflow);
  const confirmedProfit = recognizedFinanceAmount
    .minus(soldPurchaseCost)
    .minus(soldSharedCosts)
    .minus(manualLossPurchaseCost)
    .minus(manualLossSharedCosts)
    .minus(ozonWriteoffPurchaseCost)
    .minus(ozonWriteoffSharedCosts);
  const purchaseCashOutflow = sum(input.purchases.map((purchase) => d(purchase.amountPaid)));
  const expenseCashOutflow = sum(input.expenses.map((expense) => d(expense.amount)));
  const supplyShippingOutflow = sum(input.supplies.map((supply) => d(supply.shippingCost)));

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
    confirmedProfit: money(confirmedProfit),
    cashBreakdown: {
      recognizedOzon: money(recognizedFinanceAmount),
      purchases: money(purchaseCashOutflow.negated()),
      expenses: money(expenseCashOutflow.negated()),
      supplyShipping: money(supplyShippingOutflow.negated()),
      total: money(cashBalance),
    },
    profitBreakdown: {
      recognizedOzon: money(recognizedFinanceAmount),
      soldPurchaseCost: money(soldPurchaseCost.negated()),
      soldSharedCosts: money(soldSharedCosts.negated()),
      manualLossPurchaseCost: money(manualLossPurchaseCost.negated()),
      manualLossSharedCosts: money(manualLossSharedCosts.negated()),
      ozonWriteoffPurchaseCost: money(ozonWriteoffPurchaseCost.negated()),
      ozonWriteoffSharedCosts: money(ozonWriteoffSharedCosts.negated()),
      total: money(confirmedProfit),
    },
    sharedExpenseCoefficient: sharedExpenseCoefficient.toDecimalPlaces(4).toFixed(2),
    receivedPurchaseValue: money(receivedPurchaseValue),
    sharedExpenses: money(sharedExpenses),
    preliminaryOrders: { count: previewCount, grossAmount: money(previewGross), expectedProfit: money(previewProfit) },
    products,
    reconciliationErrors,
    recognizedPostingIds: [...recognizedPostings],
    unrecognizedFinanceAmount: money(unrecognizedFinanceAmount),
  };
}
