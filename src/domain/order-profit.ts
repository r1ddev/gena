import Decimal from "decimal.js";

export type OrderProfitItem = {
  productId: string | null;
  quantity: string | number;
  unitCost: string | null;
  movementEnabled?: boolean;
};

export type OrderProfitReturn = {
  productId: string;
  quantity: string | number;
};

export type OrderProfitWriteoff = OrderProfitReturn;

export type OrderProfitPosting = {
  id: string;
  externalId: string;
  status: string;
};

export type OrderProfitPostingItem = Omit<OrderProfitItem, "unitCost"> & {
  postingId: string;
};

export type OrderProfitPostingReturn = OrderProfitReturn & {
  postingNumber: string;
};

export function isDeliveredPostingStatus(status: string) {
  const normalized = status.trim().toLocaleLowerCase("ru-RU").replace(/[\s-]+/g, "_");
  return normalized === "delivered" || /^доставлен[аоы]?$/.test(normalized);
}

export function isFinalPostingStatus(status: string) {
  const normalized = status.trim().toLocaleLowerCase("ru-RU").replace(/[\s-]+/g, "_");
  return isDeliveredPostingStatus(normalized) || /cancel|отмен|declin|reject/i.test(normalized);
}

export function calculateFinalPostingProfitCents(input: {
  status: string;
  amountCents: number;
  items: OrderProfitItem[];
  returns: OrderProfitReturn[];
  writeoffs?: OrderProfitWriteoff[];
}) {
  const status = input.status.trim().toLocaleLowerCase("ru-RU").replace(/[\s-]+/g, "_");
  const cancelled = /cancel|отмен|declin|reject/i.test(status);
  if (!isFinalPostingStatus(status)) return { profitCents: null, productCostCents: null, missingCost: false };
  if (cancelled) {
    const costByProduct = new Map<string, string | null>();
    const quantityByProduct = new Map<string, Decimal>();
    for (const item of input.items) {
      if (!item.productId || item.movementEnabled === false) continue;
      const quantity = new Decimal(item.quantity);
      if (!quantity.isFinite() || quantity.lte(0)) continue;
      costByProduct.set(item.productId, item.unitCost);
      quantityByProduct.set(item.productId, (quantityByProduct.get(item.productId) ?? new Decimal(0)).plus(quantity));
    }
    let productCost = new Decimal(0);
    let missingCost = false;
    const chargedByProduct = new Map<string, Decimal>();
    for (const writeoff of input.writeoffs ?? []) {
      const quantity = new Decimal(writeoff.quantity);
      if (!quantity.isFinite() || quantity.lte(0)) continue;
      const available = Decimal.max(0, (quantityByProduct.get(writeoff.productId) ?? new Decimal(0)).minus(chargedByProduct.get(writeoff.productId) ?? 0));
      const acceptedQuantity = Decimal.min(quantity, available);
      if (acceptedQuantity.lt(quantity)) missingCost = true;
      if (!acceptedQuantity.gt(0)) continue;
      chargedByProduct.set(writeoff.productId, (chargedByProduct.get(writeoff.productId) ?? new Decimal(0)).plus(acceptedQuantity));
      const unitCost = costByProduct.get(writeoff.productId);
      if (unitCost === null || unitCost === undefined || unitCost === "") {
        missingCost = true;
        continue;
      }
      productCost = productCost.plus(new Decimal(unitCost).times(acceptedQuantity));
    }
    if (missingCost) return { profitCents: null, productCostCents: null, missingCost: true };
    const productCostCents = productCost.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
    return { profitCents: input.amountCents - productCostCents, productCostCents, missingCost: false };
  }

  const deliveredQuantityByProduct = new Map<string, Decimal>();
  const unitCostByProduct = new Map<string, string | null>();
  let unmappedDeliveredQuantity = new Decimal(0);
  for (const item of input.items) {
    if (item.movementEnabled === false) continue;
    const quantity = new Decimal(item.quantity);
    if (!quantity.isFinite() || quantity.lte(0)) continue;
    if (!item.productId) {
      unmappedDeliveredQuantity = unmappedDeliveredQuantity.plus(quantity);
      continue;
    }
    deliveredQuantityByProduct.set(item.productId, (deliveredQuantityByProduct.get(item.productId) ?? new Decimal(0)).plus(quantity));
    unitCostByProduct.set(item.productId, item.unitCost);
  }

  const returnedQuantityByProduct = new Map<string, Decimal>();
  for (const returned of input.returns) {
    const quantity = new Decimal(returned.quantity);
    if (!quantity.isFinite() || quantity.lte(0)) continue;
    returnedQuantityByProduct.set(returned.productId, (returnedQuantityByProduct.get(returned.productId) ?? new Decimal(0)).plus(quantity));
  }

  let productCost = new Decimal(0);
  let missingCost = unmappedDeliveredQuantity.gt(0);
  for (const [productId, deliveredQuantity] of deliveredQuantityByProduct) {
    const soldQuantity = Decimal.max(0, deliveredQuantity.minus(returnedQuantityByProduct.get(productId) ?? 0));
    if (soldQuantity.isZero()) continue;
    const unitCost = unitCostByProduct.get(productId);
    if (unitCost === null || unitCost === undefined || unitCost === "") {
      missingCost = true;
      continue;
    }
    productCost = productCost.plus(new Decimal(unitCost).times(soldQuantity));
  }

  if (missingCost) return { profitCents: null, productCostCents: null, missingCost: true };
  const productCostCents = productCost.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  return { profitCents: input.amountCents - productCostCents, productCostCents, missingCost: false };
}

export function calculateFinalPostingProfits(input: {
  postings: OrderProfitPosting[];
  items: OrderProfitPostingItem[];
  returns: OrderProfitPostingReturn[];
  writeoffs?: OrderProfitPostingReturn[];
  amountCentsByPosting: Map<string, number>;
  unitCostByProduct: Map<string, string | null>;
}) {
  const postingByExternalId = new Map(input.postings.map((posting) => [posting.externalId, posting]));
  const itemsByPosting = new Map<string, OrderProfitPostingItem[]>();
  const productIdsByPosting = new Map<string, Set<string>>();
  for (const item of input.items) {
    itemsByPosting.set(item.postingId, [...(itemsByPosting.get(item.postingId) ?? []), item]);
    if (item.productId) {
      productIdsByPosting.set(item.postingId, new Set([
        ...(productIdsByPosting.get(item.postingId) ?? []),
        item.productId,
      ]));
    }
  }

  const returnsByPosting = new Map<string, OrderProfitPostingReturn[]>();
  const writeoffsByPosting = new Map<string, OrderProfitPostingReturn[]>();
  for (const returned of input.returns) {
    const posting = postingByExternalId.get(returned.postingNumber);
    if (!posting || !productIdsByPosting.get(posting.id)?.has(returned.productId)) continue;
    returnsByPosting.set(returned.postingNumber, [...(returnsByPosting.get(returned.postingNumber) ?? []), returned]);
  }

  for (const writeoff of input.writeoffs ?? []) {
    const posting = postingByExternalId.get(writeoff.postingNumber);
    if (!posting || !productIdsByPosting.get(posting.id)?.has(writeoff.productId)) continue;
    writeoffsByPosting.set(writeoff.postingNumber, [...(writeoffsByPosting.get(writeoff.postingNumber) ?? []), writeoff]);
  }

  return new Map(input.postings.map((posting) => {
    const calculation = calculateFinalPostingProfitCents({
      status: posting.status,
      amountCents: input.amountCentsByPosting.get(posting.externalId) ?? 0,
      items: (itemsByPosting.get(posting.id) ?? []).map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        movementEnabled: item.movementEnabled,
        unitCost: item.productId ? input.unitCostByProduct.get(item.productId) ?? null : null,
      })),
      returns: (returnsByPosting.get(posting.externalId) ?? []).map(({ productId, quantity }) => ({ productId, quantity })),
      writeoffs: (writeoffsByPosting.get(posting.externalId) ?? []).map(({ productId, quantity }) => ({ productId, quantity })),
    });
    return [posting.externalId, calculation] as const;
  }));
}
