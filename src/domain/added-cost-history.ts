import Decimal from "decimal.js";
import type { AccountingInput } from "./accounting";

Decimal.set({ precision: 24, rounding: Decimal.ROUND_HALF_UP });

type HistoryEvent = {
  at: number;
  priority: number;
  key: string;
  apply: () => void;
};

type Inventory = { quantity: Decimal; purchaseValue: Decimal };
type SaleAllocation = { quantity: Decimal; unitCost: Decimal; rate: Decimal };

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Replays shared costs and catalog stock chronologically; every returned value is percentage points. */
export function calculateAddedCostRateByPosting(input: AccountingInput, now = new Date()) {
  const events: HistoryEvent[] = [];
  const inventory = new Map<string, Inventory>();
  const allocations = new Map<string, SaleAllocation>();
  const rates = new Map<string, string>();
  let unallocatedSharedCosts = new Decimal(0);

  const addEvent = (at: string | null | undefined, priority: number, key: string, apply: () => void) => {
    const eventAt = timestamp(at);
    if (eventAt === null || eventAt > now.getTime()) return;
    events.push({ at: eventAt, priority, key, apply });
  };
  const stock = (productId: string) => inventory.get(productId) ?? { quantity: new Decimal(0), purchaseValue: new Decimal(0) };

  for (const receipt of input.receipts) {
    if (receipt.includeInAverageCost === false) continue;
    const quantity = new Decimal(receipt.quantity);
    const unitCost = new Decimal(receipt.unitCost);
    if (!quantity.isFinite() || quantity.lte(0) || !unitCost.isFinite() || unitCost.lte(0)) continue;
    addEvent(receipt.receivedAt, 0, `receipt:${receipt.productId}:${events.length}`, () => {
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
    addEvent(expense.spentAt, 1, `my-expense:${events.length}`, () => { unallocatedSharedCosts = unallocatedSharedCosts.plus(amount); });
  }
  for (const expense of input.ozonSharedExpenses ?? []) {
    const amount = new Decimal(expense.amount).negated();
    if (!amount.isFinite() || amount.isZero()) continue;
    addEvent(expense.spentAt, 1, `ozon-expense:${events.length}`, () => { unallocatedSharedCosts = unallocatedSharedCosts.plus(amount); });
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
  for (const posting of input.postings) {
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
    addEvent(saleAt, 3, `sale:${posting.id}`, () => {
      const totalPurchaseValue = [...inventory.values()].reduce((total, item) => total.plus(item.purchaseValue), new Decimal(0));
      if (!totalPurchaseValue.gt(0)) return;
      const rate = unallocatedSharedCosts.div(totalPurchaseValue).times(100);
      rates.set(posting.id, rate.toDecimalPlaces(8).toFixed(8));

      const quantityByProduct = new Map<string, Decimal>();
      for (const item of items) {
        if (!item.productId) continue;
        const quantity = new Decimal(item.quantity);
        if (!quantity.isFinite() || quantity.lte(0)) continue;
        quantityByProduct.set(item.productId, (quantityByProduct.get(item.productId) ?? new Decimal(0)).plus(quantity));
      }
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
        unallocatedSharedCosts = unallocatedSharedCosts.minus(removedPurchaseValue.times(rate).div(100));
        inventory.set(productId, {
          quantity: current.quantity.minus(removedQuantity),
          purchaseValue: current.purchaseValue.minus(removedPurchaseValue),
        });
      }
    });
  }

  const returnWriteoffs: { at: string; productId: string; quantity: string | number; key: string }[] = [];
  const sellerReturnedByPostingAndProduct = new Map<string, Decimal>();
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
    addEvent(returnedAt, 2, `return:${returned.externalId ?? events.length}`, () => {
      const allocationKey = `${postingId}\u0000${productId}`;
      const allocation = allocations.get(allocationKey);
      if (allocation?.quantity.gt(0)) {
        const restoredQuantity = Decimal.min(quantity, allocation.quantity);
        const current = stock(productId);
        const restoredPurchaseValue = allocation.unitCost.times(restoredQuantity);
        inventory.set(productId, {
          quantity: current.quantity.plus(restoredQuantity),
          purchaseValue: current.purchaseValue.plus(restoredPurchaseValue),
        });
        unallocatedSharedCosts = unallocatedSharedCosts.plus(restoredPurchaseValue.times(allocation.rate).div(100));
        allocations.set(allocationKey, { ...allocation, quantity: allocation.quantity.minus(restoredQuantity) });
      }

      if (returned.destination === "seller") {
        const postedQuantities = quantityByPostingAndProduct.get(postingId);
        if (!postedQuantities) return;
        const returnKey = `${postingId}\u0000${productId}`;
        const previousReturnQuantity = sellerReturnedByPostingAndProduct.get(returnKey) ?? new Decimal(0);
        const postedQuantity = postedQuantities.get(productId) ?? new Decimal(0);
        sellerReturnedByPostingAndProduct.set(returnKey, Decimal.min(postedQuantity, previousReturnQuantity.plus(quantity)));
        const wholeCatalogSaleReturned = [...postedQuantities].every(([postedProductId, postedProductQuantity]) =>
          (sellerReturnedByPostingAndProduct.get(`${postingId}\u0000${postedProductId}`) ?? new Decimal(0)).gte(postedProductQuantity),
        );
        if (wholeCatalogSaleReturned) rates.delete(postingId);
      }
    });
    if (returned.writtenOffAt) {
      returnWriteoffs.push({ at: returned.writtenOffAt, productId, quantity: returned.quantity, key: `return-writeoff:${returned.externalId ?? events.length}` });
    }
  }

  const addWriteoff = (at: string | null | undefined, productId: string | null | undefined, rawQuantity: string | number, key: string) => {
    if (!productId) return;
    const quantity = new Decimal(rawQuantity);
    if (!quantity.isFinite() || quantity.lte(0)) return;
    addEvent(at, 4, key, () => {
      const current = stock(productId);
      if (!current.quantity.gt(0) || !current.purchaseValue.gt(0)) return;
      const removedQuantity = Decimal.min(quantity, current.quantity);
      const unitCost = current.purchaseValue.div(current.quantity);
      const removedPurchaseValue = unitCost.times(removedQuantity);
      const totalPurchaseValue = [...inventory.values()].reduce((total, item) => total.plus(item.purchaseValue), new Decimal(0));
      if (totalPurchaseValue.gt(0)) {
        const rate = unallocatedSharedCosts.div(totalPurchaseValue).times(100);
        unallocatedSharedCosts = unallocatedSharedCosts.minus(removedPurchaseValue.times(rate).div(100));
      }
      inventory.set(productId, {
        quantity: current.quantity.minus(removedQuantity),
        purchaseValue: current.purchaseValue.minus(removedPurchaseValue),
      });
    });
  };
  for (const writeoff of input.manualWriteoffs) addWriteoff(writeoff.writtenOffAt, writeoff.productId, writeoff.quantity, `manual-writeoff:${events.length}`);
  for (const writeoff of input.ozonWriteoffs) addWriteoff(writeoff.occurredAt, writeoff.productId, writeoff.quantity, `ozon-writeoff:${events.length}`);
  for (const writeoff of returnWriteoffs) addWriteoff(writeoff.at, writeoff.productId, writeoff.quantity, writeoff.key);

  events.sort((left, right) => left.at - right.at || left.priority - right.priority || left.key.localeCompare(right.key));
  for (const event of events) event.apply();
  return rates;
}
