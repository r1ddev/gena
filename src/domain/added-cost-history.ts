import Decimal from "decimal.js";
import type { AccountingInput } from "./accounting";

Decimal.set({ precision: 24, rounding: Decimal.ROUND_HALF_UP });

export type AddedCostOperationKind = "receipt" | "my_expense" | "ozon_expense" | "sale" | "return" | "writeoff";

export type AddedCostHistoryOperation = {
  id: string;
  kind: AddedCostOperationKind;
  title: string;
  details: string;
  occurredAt: string;
  sortAt: string;
  postingId?: string;
  postingNumber?: string;
  orderNumber?: string;
  orderDate?: string | null;
  purchaseDate?: string;
  status?: string;
  sourceNumber?: string;
  sourceNumberIsAccrual?: boolean;
  productId?: string;
  productSku?: string;
  productTitle?: string;
  quantity?: string;
  unitCost?: string;
  note?: string;
  poolBefore: string;
  poolDelta: string;
  poolAfter: string;
  stockValueBefore: string;
  stockValueDelta: string;
  stockValueAfter: string;
  stockQuantityBefore: string;
  stockQuantityDelta: string;
  stockQuantityAfter: string;
  ratePercent?: string;
  purchaseValueSold?: string;
  allocatedSharedCosts?: string;
  explanation?: string;
};

type EventMetadata = Omit<AddedCostHistoryOperation,
  | "occurredAt"
  | "sortAt"
  | "poolBefore"
  | "poolDelta"
  | "poolAfter"
  | "stockValueBefore"
  | "stockValueDelta"
  | "stockValueAfter"
  | "stockQuantityBefore"
  | "stockQuantityDelta"
  | "stockQuantityAfter"
  | "ratePercent"
  | "purchaseValueSold"
  | "allocatedSharedCosts"
  | "explanation"
>;

type EventResult = Pick<AddedCostHistoryOperation, "ratePercent" | "purchaseValueSold" | "allocatedSharedCosts" | "explanation"> | void;
type HistoryEvent = {
  at: number;
  occurredAt: string;
  sortAt: string;
  priority: number;
  key: string;
  metadata: EventMetadata;
  apply: () => EventResult;
};

type Inventory = { quantity: Decimal; purchaseValue: Decimal };
type SaleAllocation = { quantity: Decimal; unitCost: Decimal; rate: Decimal };

export type AddedCostBreakdown = {
  sharedCostsBefore: string;
  purchaseValueBefore: string;
  ratePercent: string;
  purchaseValueSold: string;
  allocatedSharedCosts: string;
  sharedCostsAfter: string;
  purchaseValueAfter: string;
  fullyReturned?: true;
};

export type AddedCostHistory = {
  rates: Map<string, string>;
  breakdowns: Map<string, AddedCostBreakdown>;
  operations: AddedCostHistoryOperation[];
};

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isCancelledStatus(status: string) {
  const normalized = status.trim().toLocaleLowerCase("ru-RU").replace(/[\s-]+/g, "_");
  return /cancel|отмен|declin|reject/i.test(normalized);
}

function displayProduct(productSku?: string, productTitle?: string) {
  return [productTitle, productSku ? `артикул ${productSku}` : ""].filter(Boolean).join(" · ") || "Товар";
}

/** Replays shared costs and catalog stock chronologically; the rate is percentage points. */
export function calculateAddedCostHistoryByPosting(input: AccountingInput, now = new Date()): AddedCostHistory {
  const events: HistoryEvent[] = [];
  const inventory = new Map<string, Inventory>();
  const allocations = new Map<string, SaleAllocation>();
  const rates = new Map<string, string>();
  const breakdowns = new Map<string, AddedCostBreakdown>();
  const operations: AddedCostHistoryOperation[] = [];
  let unallocatedSharedCosts = new Decimal(0);

  const addEvent = (
    at: string | null | undefined,
    priority: number,
    key: string,
    metadata: EventMetadata,
    apply: () => EventResult,
  ) => {
    const eventAt = timestamp(at);
    if (eventAt === null || eventAt > now.getTime()) return;
    const occurredAt = new Date(eventAt).toISOString();
    const orderTimestamp = metadata.kind === "sale" ? timestamp(metadata.orderDate) : null;
    const sortAt = orderTimestamp === null ? occurredAt : new Date(orderTimestamp).toISOString();
    events.push({ at: eventAt, occurredAt, sortAt, priority, key, metadata, apply });
  };
  const stock = (productId: string) => inventory.get(productId) ?? { quantity: new Decimal(0), purchaseValue: new Decimal(0) };
  const inventorySnapshot = () => [...inventory.values()].reduce((total, item) => ({
    quantity: total.quantity.plus(item.quantity),
    purchaseValue: total.purchaseValue.plus(item.purchaseValue),
  }), { quantity: new Decimal(0), purchaseValue: new Decimal(0) });

  for (const receipt of input.receipts) {
    if (receipt.includeInAverageCost === false) continue;
    const quantity = new Decimal(receipt.quantity);
    const unitCost = new Decimal(receipt.unitCost);
    if (!quantity.isFinite() || quantity.lte(0) || !unitCost.isFinite() || unitCost.lte(0)) continue;
    const product = displayProduct(receipt.productSku, receipt.productTitle);
    addEvent(receipt.receivedAt, 0, `receipt:${receipt.productId}:${events.length}`, {
      id: `receipt:${receipt.purchaseId ?? receipt.productId}:${events.length}`,
      kind: "receipt",
      title: "Приёмка закупки",
      details: `${product} · ${quantity.toString()} шт. по ${unitCost.toString()} ₽`,
      productId: receipt.productId,
      productSku: receipt.productSku,
      productTitle: receipt.productTitle,
      purchaseDate: receipt.purchaseDate,
      quantity: quantity.toString(),
      unitCost: unitCost.toString(),
      note: [receipt.purchaseNote, receipt.receiptNote].filter(Boolean).join(" · ") || undefined,
    }, () => {
      const current = stock(receipt.productId);
      inventory.set(receipt.productId, {
        quantity: current.quantity.plus(quantity),
        purchaseValue: current.purchaseValue.plus(quantity.times(unitCost)),
      });
    });
  }

  for (const expense of input.expenses) {
    const amount = new Decimal(expense.amount);
    if (!amount.isFinite() || amount.isZero()) continue;
    addEvent(expense.spentAt, 1, `my-expense:${events.length}`, {
      id: `my-expense:${events.length}`,
      kind: "my_expense",
      title: "Мой расход",
      details: expense.sourceLabel || "Расход без названия",
      note: expense.note || undefined,
    }, () => {
      unallocatedSharedCosts = unallocatedSharedCosts.plus(amount);
    });
  }
  for (const expense of input.ozonSharedExpenses ?? []) {
    const amount = new Decimal(expense.amount).negated();
    if (!amount.isFinite() || amount.isZero()) continue;
    addEvent(expense.spentAt, 1, `ozon-expense:${events.length}`, {
      id: `ozon-expense:${expense.externalKey ?? events.length}`,
      kind: "ozon_expense",
      title: "Общая операция Ozon",
      details: expense.sourceLabel || "Операция Ozon без названия",
      sourceNumber: expense.unitNumber || undefined,
      sourceNumberIsAccrual: expense.typeId === "71" || Boolean(expense.unitNumber?.startsWith("sr01-")),
    }, () => {
      unallocatedSharedCosts = unallocatedSharedCosts.plus(amount);
    });
  }

  const itemsByPosting = new Map<string, AccountingInput["postingItems"]>();
  for (const item of input.postingItems) {
    itemsByPosting.set(item.postingId, [...(itemsByPosting.get(item.postingId) ?? []), item]);
  }
  const quantityByPostingAndProduct = new Map<string, Map<string, Decimal>>();
  for (const [postingId, items] of itemsByPosting) {
    for (const item of items) {
      if (!item.productId || item.movementEnabled === false) continue;
      const quantity = new Decimal(item.quantity);
      if (!quantity.isFinite() || quantity.lte(0)) continue;
      const quantities = quantityByPostingAndProduct.get(postingId) ?? new Map<string, Decimal>();
      quantities.set(item.productId, (quantities.get(item.productId) ?? new Decimal(0)).plus(quantity));
      quantityByPostingAndProduct.set(postingId, quantities);
    }
  }
  const postingById = new Map(input.postings.map((posting) => [posting.id, posting]));
  const productById = new Map(input.products.map((product) => [product.id, product]));
  for (const posting of input.postings) {
    if (isCancelledStatus(posting.status)) continue;
    const items = (itemsByPosting.get(posting.id) ?? []).filter((item) => item.productId && item.movementEnabled !== false);
    const buyoutItems = items.filter((item) => item.isMarketplaceBuyout || posting.isMarketplaceBuyout);
    const hasDeliveryEvent = Boolean(posting.deliveredAt);
    if (!hasDeliveryEvent && !buyoutItems.length) continue;
    const buyoutTimes = buyoutItems
      .map((item) => timestamp(item.marketplaceBuyoutAt ?? posting.marketplaceBuyoutAt))
      .filter((value): value is number => value !== null);
    const saleAt = hasDeliveryEvent
      ? posting.deliveredAt
      : buyoutTimes.length ? new Date(Math.min(...buyoutTimes)).toISOString() : null;
    if (!saleAt) continue;

    const quantityByProduct = new Map<string, Decimal>();
    for (const item of items) {
      if (!item.productId) continue;
      const quantity = new Decimal(item.quantity);
      if (!quantity.isFinite() || quantity.lte(0)) continue;
      quantityByProduct.set(item.productId, (quantityByProduct.get(item.productId) ?? new Decimal(0)).plus(quantity));
    }
    const products = [...quantityByProduct.entries()].map(([productId, quantity]) => {
      const product = productById.get(productId);
      return { productId, quantity, sku: product?.sku ?? "", title: product?.title ?? "" };
    });
    const orderDetails = products.map(({ quantity, sku, title }) => `${displayProduct(sku, title)} × ${quantity.toString()} шт.`).join("; ");
    addEvent(saleAt, 3, `sale:${posting.id}`, {
      id: `sale:${posting.id}`,
      kind: "sale",
      title: posting.isMarketplaceBuyout || buyoutItems.length ? "Выкуп заказа" : "Продажа",
      details: orderDetails || "Товары из каталога не найдены",
      postingId: posting.id,
      postingNumber: posting.externalId,
      orderNumber: posting.orderNumber,
      orderDate: posting.orderDate ?? null,
      status: posting.status,
    }, () => {
      const totalPurchaseValue = inventorySnapshot().purchaseValue;
      if (!totalPurchaseValue.gt(0)) {
        return { explanation: "На эту дату у каталога не было закупочной стоимости остатков, поэтому процент не рассчитан." };
      }
      const sharedCostsBefore = unallocatedSharedCosts;
      const rate = unallocatedSharedCosts.div(totalPurchaseValue).times(100);
      rates.set(posting.id, rate.toDecimalPlaces(8).toFixed(8));

      let purchaseValueSold = new Decimal(0);
      for (const [productId, quantity] of quantityByProduct) {
        const current = stock(productId);
        if (!current.quantity.gt(0) || !current.purchaseValue.gt(0)) continue;
        const removedQuantity = Decimal.min(quantity, current.quantity);
        const unitCost = current.purchaseValue.div(current.quantity);
        const removedPurchaseValue = unitCost.times(removedQuantity);
        const allocationKey = `${posting.id}\u0000${productId}`;
        const previous = allocations.get(allocationKey);
        allocations.set(allocationKey, {
          quantity: (previous?.quantity ?? new Decimal(0)).plus(removedQuantity),
          unitCost,
          rate,
        });
        purchaseValueSold = purchaseValueSold.plus(removedPurchaseValue);
        unallocatedSharedCosts = unallocatedSharedCosts.minus(removedPurchaseValue.times(rate).div(100));
        inventory.set(productId, {
          quantity: current.quantity.minus(removedQuantity),
          purchaseValue: current.purchaseValue.minus(removedPurchaseValue),
        });
      }
      const allocatedSharedCosts = purchaseValueSold.times(rate).div(100);
      breakdowns.set(posting.id, {
        sharedCostsBefore: sharedCostsBefore.toString(),
        purchaseValueBefore: totalPurchaseValue.toString(),
        ratePercent: rate.toDecimalPlaces(8).toFixed(8),
        purchaseValueSold: purchaseValueSold.toString(),
        allocatedSharedCosts: allocatedSharedCosts.toString(),
        sharedCostsAfter: unallocatedSharedCosts.toString(),
        purchaseValueAfter: totalPurchaseValue.minus(purchaseValueSold).toString(),
      });
      return {
        ratePercent: rate.toDecimalPlaces(8).toFixed(8),
        purchaseValueSold: purchaseValueSold.toString(),
        allocatedSharedCosts: allocatedSharedCosts.toString(),
      };
    });
  }

  const returnWriteoffs: {
    at: string;
    productId: string;
    quantity: string | number;
    key: string;
    externalId?: string;
    postingNumber?: string | null;
    productSku?: string;
    productTitle?: string;
    note?: string;
  }[] = [];
  const restockedByPostingAndProduct = new Map<string, Decimal>();
  for (const returned of input.returns) {
    const postingId = returned.postingId;
    const productId = returned.productId;
    if (!postingId || !productId) continue;
    const returnedAt = returned.destination === "seller"
      ? returned.receivedBySellerAt
      : returned.destination === "ozon" ? returned.availableAtOzon : null;
    const quantity = new Decimal(returned.quantity);
    const returnTime = timestamp(returnedAt);
    const writeoffTime = timestamp(returned.writtenOffAt);
    if (!quantity.isFinite() || quantity.lte(0) || returnTime === null || (writeoffTime !== null && returnTime > writeoffTime)) continue;
    const posting = postingById.get(postingId);
    const product = productById.get(productId);
    const destination = returned.destination === "seller" ? "продавцу" : "на склад Ozon";
    addEvent(returnedAt, 2, `return:${returned.externalId ?? events.length}`, {
      id: `return:${returned.externalId ?? events.length}`,
      kind: "return",
      title: "Возврат товара",
      details: `${displayProduct(returned.productSku || product?.sku, returned.productTitle || product?.title)} · ${quantity.toString()} шт. · ${destination}`,
      postingId,
      postingNumber: returned.postingNumber || posting?.externalId,
      orderNumber: posting?.orderNumber,
      orderDate: posting?.orderDate ?? null,
      status: returned.status,
      productId,
      productSku: returned.productSku || product?.sku,
      productTitle: returned.productTitle || product?.title,
      quantity: quantity.toString(),
      note: returned.note || undefined,
    }, () => {
      const allocationKey = `${postingId}\u0000${productId}`;
      const allocation = allocations.get(allocationKey);
      let restoredQuantity = new Decimal(0);
      if (allocation?.quantity.gt(0)) {
        restoredQuantity = Decimal.min(quantity, allocation.quantity);
        const current = stock(productId);
        const restoredPurchaseValue = allocation.unitCost.times(restoredQuantity);
        inventory.set(productId, {
          quantity: current.quantity.plus(restoredQuantity),
          purchaseValue: current.purchaseValue.plus(restoredPurchaseValue),
        });
        unallocatedSharedCosts = unallocatedSharedCosts.plus(restoredPurchaseValue.times(allocation.rate).div(100));
        allocations.set(allocationKey, { ...allocation, quantity: allocation.quantity.minus(restoredQuantity) });
      }

      if (returned.destination === "seller" || returned.destination === "ozon") {
        const postedQuantities = quantityByPostingAndProduct.get(postingId);
        if (postedQuantities) {
          const returnKey = `${postingId}\u0000${productId}`;
          const previousReturnQuantity = restockedByPostingAndProduct.get(returnKey) ?? new Decimal(0);
          const postedQuantity = postedQuantities.get(productId) ?? new Decimal(0);
          restockedByPostingAndProduct.set(returnKey, Decimal.min(postedQuantity, previousReturnQuantity.plus(quantity)));
          const wholeCatalogSaleReturned = [...postedQuantities].every(([postedProductId, postedProductQuantity]) =>
            (restockedByPostingAndProduct.get(`${postingId}\u0000${postedProductId}`) ?? new Decimal(0)).gte(postedProductQuantity),
          );
          if (wholeCatalogSaleReturned) {
            rates.delete(postingId);
            const breakdown = breakdowns.get(postingId);
            if (breakdown) breakdowns.set(postingId, { ...breakdown, fullyReturned: true });
          }
        }
      }
      return restoredQuantity.gt(0)
        ? { explanation: "Вернулись товар и та доля расходов, которую распределили на это отправление." }
        : { explanation: "Ранее на это отправление не распределялась закупочная стоимость, возвращать сумму в нераспределённые расходы нечего." };
    });
    if (returned.writtenOffAt) {
      returnWriteoffs.push({
        at: returned.writtenOffAt,
        productId,
        quantity: returned.quantity,
        key: `return-writeoff:${returned.externalId ?? events.length}`,
        externalId: returned.externalId,
        postingNumber: returned.postingNumber || posting?.externalId,
        productSku: returned.productSku || product?.sku,
        productTitle: returned.productTitle || product?.title,
        note: returned.note,
      });
    }
  }

  const addWriteoff = (
    at: string | null | undefined,
    productId: string | null | undefined,
    rawQuantity: string | number,
    key: string,
    metadata: Partial<EventMetadata>,
  ) => {
    if (!productId) return;
    const quantity = new Decimal(rawQuantity);
    if (!quantity.isFinite() || quantity.lte(0)) return;
    addEvent(at, 4, key, {
      id: key,
      kind: "writeoff",
      title: "Списание товара",
      details: `${displayProduct(metadata.productSku, metadata.productTitle)} · ${quantity.toString()} шт.`,
      productId,
      productSku: metadata.productSku,
      productTitle: metadata.productTitle,
      quantity: quantity.toString(),
      postingId: metadata.postingId,
      postingNumber: metadata.postingNumber,
      orderNumber: metadata.orderNumber,
      orderDate: metadata.orderDate,
      note: metadata.note,
      ...metadata,
    }, () => {
      const current = stock(productId);
      if (!current.quantity.gt(0) || !current.purchaseValue.gt(0)) {
        return { explanation: "На эту дату в остатках не было закупочной стоимости для списания." };
      }
      const removedQuantity = Decimal.min(quantity, current.quantity);
      const unitCost = current.purchaseValue.div(current.quantity);
      const removedPurchaseValue = unitCost.times(removedQuantity);
      const totalPurchaseValue = inventorySnapshot().purchaseValue;
      if (totalPurchaseValue.gt(0)) {
        const rate = unallocatedSharedCosts.div(totalPurchaseValue).times(100);
        unallocatedSharedCosts = unallocatedSharedCosts.minus(removedPurchaseValue.times(rate).div(100));
      }
      inventory.set(productId, {
        quantity: current.quantity.minus(removedQuantity),
        purchaseValue: current.purchaseValue.minus(removedPurchaseValue),
      });
      return { explanation: "Вместе с товаром из остатков убрана соответствующая доля нераспределённых расходов." };
    });
  };
  for (const writeoff of input.manualWriteoffs) {
    const product = productById.get(writeoff.productId);
    addWriteoff(writeoff.writtenOffAt, writeoff.productId, writeoff.quantity, `manual-writeoff:${events.length}`, {
      title: "Списание вручную",
      productSku: writeoff.productSku || product?.sku,
      productTitle: writeoff.productTitle || product?.title,
      note: writeoff.note,
    });
  }
  for (const writeoff of input.ozonWriteoffs) {
    const product = writeoff.productId ? productById.get(writeoff.productId) : undefined;
    addWriteoff(writeoff.occurredAt, writeoff.productId, writeoff.quantity, `ozon-writeoff:${events.length}`, {
      title: "Списание Ozon",
      productSku: writeoff.productSku || product?.sku,
      productTitle: writeoff.productTitle || product?.title,
      note: [writeoff.externalId ? `Запись Ozon ${writeoff.externalId}` : "", writeoff.compensationAmount != null ? `Компенсация ${writeoff.compensationAmount} ₽` : ""].filter(Boolean).join(" · ") || undefined,
    });
  }
  for (const writeoff of returnWriteoffs) {
    const posting = writeoff.postingNumber ? input.postings.find((item) => item.externalId === writeoff.postingNumber) : undefined;
    addWriteoff(writeoff.at, writeoff.productId, writeoff.quantity, writeoff.key, {
      title: "Списание возвращённого товара",
      productSku: writeoff.productSku,
      productTitle: writeoff.productTitle,
      postingNumber: writeoff.postingNumber || undefined,
      postingId: posting?.id,
      orderNumber: posting?.orderNumber,
      orderDate: posting?.orderDate ?? null,
      note: writeoff.note || undefined,
    });
  }

  events.sort((left, right) => left.at - right.at || left.priority - right.priority || left.key.localeCompare(right.key));
  for (const event of events) {
    const beforeStock = inventorySnapshot();
    const poolBefore = unallocatedSharedCosts;
    const result = event.apply() ?? {};
    const afterStock = inventorySnapshot();
    operations.push({
      ...event.metadata,
      occurredAt: event.occurredAt,
      sortAt: event.sortAt,
      poolBefore: poolBefore.toString(),
      poolDelta: unallocatedSharedCosts.minus(poolBefore).toString(),
      poolAfter: unallocatedSharedCosts.toString(),
      stockValueBefore: beforeStock.purchaseValue.toString(),
      stockValueDelta: afterStock.purchaseValue.minus(beforeStock.purchaseValue).toString(),
      stockValueAfter: afterStock.purchaseValue.toString(),
      stockQuantityBefore: beforeStock.quantity.toString(),
      stockQuantityDelta: afterStock.quantity.minus(beforeStock.quantity).toString(),
      stockQuantityAfter: afterStock.quantity.toString(),
      ...result,
    });
  }

  const fullyReturnedPostings = new Set([...breakdowns.entries()].filter(([, breakdown]) => breakdown.fullyReturned).map(([postingId]) => postingId));
  const completeOperations = operations.map((operation) => {
    if (operation.kind !== "sale" || !operation.postingId || !fullyReturnedPostings.has(operation.postingId)) return operation;
    const returnNote = "Позже весь товар по отправлению вернулся: распределённая сумма расходов восстановлена.";
    return { ...operation, explanation: operation.explanation ? `${operation.explanation} ${returnNote}` : returnNote };
  });
  return { rates, breakdowns, operations: completeOperations };
}

export function calculateAddedCostRateByPosting(input: AccountingInput, now = new Date()) {
  return calculateAddedCostHistoryByPosting(input, now).rates;
}
