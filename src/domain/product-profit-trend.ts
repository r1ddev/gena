import Decimal from "decimal.js";

export type ProductProfitDay = { date: string; productId: string; profitCents: number; units: number };

type Item = { postingId: string; productId: string | null; ozonSku?: string; quantity: string | number; price: string | number; movementEnabled?: boolean };
type Accrual = { postingId: string | null; productId?: string | null; ozonSku?: string | null; amount: string | number; category?: string; sourceGroup?: string; accrualDate?: string; isOzonWriteoffCompensation?: boolean; ignored?: boolean };

function decimal(value: string | number) {
  try {
    const result = new Decimal(value);
    return result.isFinite() ? result : null;
  } catch {
    return null;
  }
}

function allocatePostingAmount(
  postingId: string,
  amount: Decimal,
  items: Item[],
  allocated: Map<string, Decimal>,
) {
  const weights = new Map<string, Decimal>();
  for (const item of items) {
    if (!item.productId) continue;
    const quantity = decimal(item.quantity);
    const price = decimal(item.price);
    if (!quantity || !price || !quantity.gt(0)) continue;
    const weight = Decimal.max(0, price.times(quantity));
    weights.set(item.productId, (weights.get(item.productId) ?? new Decimal(0)).plus(weight));
  }
  if (![...weights.values()].some((weight) => weight.gt(0))) {
    weights.clear();
    for (const item of items) {
      if (!item.productId) continue;
      const quantity = decimal(item.quantity);
      if (!quantity || !quantity.gt(0)) continue;
      weights.set(item.productId, (weights.get(item.productId) ?? new Decimal(0)).plus(quantity));
    }
  }
  const entries = [...weights.entries()].filter(([, weight]) => weight.gt(0));
  const totalWeight = entries.reduce((sum, [, weight]) => sum.plus(weight), new Decimal(0));
  if (!totalWeight.gt(0)) return;
  let remaining = amount;
  entries.forEach(([productId, weight], index) => {
    const share = index === entries.length - 1 ? remaining : amount.times(weight).div(totalWeight);
    remaining = remaining.minus(share);
    const key = `${postingId}\u0000${productId}`;
    allocated.set(key, (allocated.get(key) ?? new Decimal(0)).plus(share));
  });
}

export function calculateProductProfitDays(input: {
  saleDays: { postingId: string; date: string }[];
  items: Item[];
  accruals: Accrual[];
  now: Date;
  returns: { postingId: string; productId: string; quantity: string | number; restocked: boolean }[];
  saleCostsByPostingProduct: Map<string, { quantity: string; unitLandedCost: string }>;
}): ProductProfitDay[] {
  const saleDateByPosting = new Map(input.saleDays.map(({ postingId, date }) => [postingId, date]));
  const itemsByPosting = new Map<string, Item[]>();
  for (const item of input.items) {
    if (!item.productId || item.movementEnabled === false) continue;
    itemsByPosting.set(item.postingId, [...(itemsByPosting.get(item.postingId) ?? []), item]);
  }

  const financeByPostingProduct = new Map<string, Decimal>();
  for (const accrual of input.accruals) {
    const postingId = accrual.postingId;
    const amount = decimal(accrual.amount);
    const category = (accrual.category ?? "").toUpperCase();
    const accrualTime = accrual.accrualDate ? Date.parse(accrual.accrualDate) : null;
    if (!postingId || !saleDateByPosting.has(postingId) || !amount || accrual.ignored || accrual.isOzonWriteoffCompensation || accrual.sourceGroup !== "orders") continue;
    if (accrualTime !== null && (!Number.isFinite(accrualTime) || accrualTime > input.now.getTime())) continue;
    if (category && !["POSTING", "ITEM", "NON_ITEM"].includes(category)) continue;
    const items = itemsByPosting.get(postingId) ?? [];
    if (!items.length) continue;
    const skuItems = accrual.ozonSku ? items.filter((item) => item.ozonSku === accrual.ozonSku) : [];
    const productItems = accrual.productId ? items.filter((item) => item.productId === accrual.productId) : [];
    const exactItems = skuItems.length ? skuItems : productItems;
    allocatePostingAmount(postingId, amount, exactItems.length ? exactItems : items, financeByPostingProduct);
  }

  const returnedByPostingProduct = new Map<string, Decimal>();
  const unresolvedReturnKeys = new Set<string>();
  for (const returned of input.returns) {
    const key = `${returned.postingId}\u0000${returned.productId}`;
    if (!returned.restocked) {
      unresolvedReturnKeys.add(key);
      continue;
    }
    const quantity = decimal(returned.quantity);
    if (!quantity || !quantity.gt(0)) continue;
    returnedByPostingProduct.set(key, (returnedByPostingProduct.get(key) ?? new Decimal(0)).plus(quantity));
  }

  const points = new Map<string, { profitCents: number; units: Decimal }>();
  for (const [postingId, items] of itemsByPosting) {
    const date = saleDateByPosting.get(postingId);
    if (!date) continue;
    const quantityByProduct = new Map<string, Decimal>();
    for (const item of items) {
      const quantity = decimal(item.quantity);
      if (!quantity || !quantity.gt(0)) continue;
      quantityByProduct.set(item.productId!, (quantityByProduct.get(item.productId!) ?? new Decimal(0)).plus(quantity));
    }
    for (const [productId, postedQuantity] of quantityByProduct) {
      const key = `${postingId}\u0000${productId}`;
      if (unresolvedReturnKeys.has(key)) continue;
      const soldQuantity = Decimal.max(0, postedQuantity.minus(returnedByPostingProduct.get(key) ?? 0));
      const saleCost = input.saleCostsByPostingProduct.get(key);
      const costedQuantity = decimal(saleCost?.quantity ?? 0);
      const unitLandedCost = decimal(saleCost?.unitLandedCost ?? 0);
      if (!soldQuantity.gt(0) || !costedQuantity || !unitLandedCost || costedQuantity.lt(soldQuantity)) continue;
      const revenue = financeByPostingProduct.get(key) ?? new Decimal(0);
      const profit = revenue.minus(unitLandedCost.times(soldQuantity));
      if (!profit.gt(0)) continue;
      const dayKey = `${date}\u0000${productId}`;
      const current = points.get(dayKey) ?? { profitCents: 0, units: new Decimal(0) };
      points.set(dayKey, {
        profitCents: current.profitCents + profit.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
        units: current.units.plus(soldQuantity),
      });
    }
  }

  return [...points.entries()].map(([key, value]) => {
    const [date, productId] = key.split("\u0000");
    return { date, productId, profitCents: value.profitCents, units: value.units.toNumber() };
  }).sort((left, right) => left.date.localeCompare(right.date) || left.productId.localeCompare(right.productId));
}
