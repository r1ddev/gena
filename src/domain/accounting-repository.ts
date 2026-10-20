import { desc, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db";
import {
  expenses,
  externalItems,
  financeAccruals,
  manualWriteoffs,
  ozonWriteoffs,
  postingItems,
  postings,
  products,
  purchaseReceipts,
  purchaseReceiptLines,
  purchases,
  returns,
  stockAdjustments,
  supplies,
  supplyLines,
} from "@/db/schema";
import { calculateAccounting, hasAccountablePostingItems } from "./accounting";
import { financePostingSaleSkus, isOzonWriteoffCompensation } from "@/ozon/finance";

export async function getAccountingSnapshot(now = new Date()) {
  const [productRows, purchaseRows, receiptRows, receiptLineRows, supplyRows, supplyLineRows, expenseRows, postingRows, postingItemRows, financeRows, returnRows, manualRows, ozonWriteoffRows, adjustmentRows, externalRows] = await Promise.all([
    db.select().from(products),
    db.select().from(purchases),
    db.select().from(purchaseReceipts),
    db.select().from(purchaseReceiptLines),
    db.select().from(supplies),
    db.select().from(supplyLines),
    db.select().from(expenses),
    db.select().from(postings),
    db.select().from(postingItems),
    db.select().from(financeAccruals),
    db.select().from(returns),
    db.select().from(manualWriteoffs),
    db.select().from(ozonWriteoffs),
    db.select().from(stockAdjustments),
    db.select().from(externalItems),
  ]);

  const postingIdByExternalId = new Map(postingRows.map((posting) => [posting.externalId, posting.id]));
  const postingById = new Map(postingRows.map((posting) => [posting.id, posting]));
  const financeSaleSkuKeys = new Set(financeRows.flatMap((row) => {
    const postingId = row.postingNumber ? postingIdByExternalId.get(row.postingNumber) : null;
    return postingId ? financePostingSaleSkus(row.raw).map((sku) => `${postingId}\u0000${sku}`) : [];
  }));
  const postingProductPairs = new Set(postingItemRows.flatMap((item) => item.productId ? [`${item.postingId}\u0000${item.productId}`] : []));
  const purchaseById = new Map(purchaseRows.map((purchase) => [purchase.id, purchase]));
  const receiptById = new Map(receiptRows.map((receipt) => [receipt.id, receipt]));
  const effectiveReceiptIds = new Set(receiptRows.filter((receipt) => Date.parse(`${receipt.receivedAt}T00:00:00.000Z`) <= now.getTime()).map((receipt) => receipt.id));
  const receivedQuantityByPurchase = new Map<string, Decimal>();
  for (const line of receiptLineRows) {
    if (!effectiveReceiptIds.has(line.receiptId)) continue;
    const purchaseId = receiptById.get(line.receiptId)?.purchaseId;
    if (!purchaseId) continue;
    receivedQuantityByPurchase.set(purchaseId, (receivedQuantityByPurchase.get(purchaseId) ?? new Decimal(0)).plus(line.quantity));
  }
  const dispositionByExternalKey = new Map(externalRows.map((item) => [item.externalKey, item.disposition]));
  const ignoredOzonSkus = new Set(externalRows.flatMap((item) => item.disposition === "ignored" && item.ozonSku ? [item.ozonSku] : []));
  const itemsByPosting = new Map<string, typeof postingItemRows>();
  for (const item of postingItemRows) itemsByPosting.set(item.postingId, [...(itemsByPosting.get(item.postingId) ?? []), item]);
  const result = calculateAccounting({
    products: productRows.map(({ id, sku, title }) => ({ id, sku, title })),
    purchases: purchaseRows.map(({ id, amountPaid }) => ({ id, amountPaid })),
    receipts: receiptLineRows.flatMap((line) => {
      const receipt = receiptById.get(line.receiptId);
      if (!receipt || !effectiveReceiptIds.has(receipt.id)) return [];
      const purchase = purchaseById.get(receipt.purchaseId);
      const totalReceived = receivedQuantityByPurchase.get(receipt.purchaseId);
      if (!purchase || !totalReceived || totalReceived.isZero()) return [];
      const costBasisQuantity = Decimal.max(new Decimal(purchase.orderedQuantity), totalReceived);
      const unitCost = new Decimal(purchase.amountPaid).div(costBasisQuantity).toString();
      return [{ productId: line.productId, quantity: line.quantity, unitCost, receivedAt: receipt.receivedAt }];
    }),
    supplies: [
      ...supplyRows.map((supply) => ({ productId: "", quantity: "0", shippingCost: supply.shippingCost, suppliedAt: supply.suppliedAt })),
      ...supplyLineRows.map((line) => ({ productId: line.productId, quantity: line.quantity, shippingCost: "0", suppliedAt: supplyRows.find((supply) => supply.id === line.supplyId)?.suppliedAt })),
    ],
    expenses: expenseRows.map(({ amount, spentAt }) => ({ amount, spentAt })),
    postings: postingRows.map(({ id, status, deliveredAt, marketplaceBuyoutAt, isMarketplaceBuyout }) => ({
      id,
      status,
      deliveredAt: deliveredAt?.toISOString() ?? null,
      marketplaceBuyoutAt: marketplaceBuyoutAt?.toISOString() ?? null,
      isMarketplaceBuyout,
      accountingEnabled: hasAccountablePostingItems((itemsByPosting.get(id) ?? []).map((item) => ({
        productId: item.productId,
        ignored: dispositionByExternalKey.get(item.externalKey) === "ignored",
      }))),
    })),
    postingItems: postingItemRows.map(({ postingId, externalKey, productId, quantity, price, movementEnabled, ozonSku, isMarketplaceBuyout, marketplaceBuyoutAt }) => ({
      postingId,
      productId,
      quantity,
      price,
      movementEnabled,
      ozonSku,
      isMarketplaceBuyout,
      marketplaceBuyoutAt: marketplaceBuyoutAt?.toISOString() ?? null,
      ignored: dispositionByExternalKey.get(externalKey) === "ignored",
    })),
    financeAccruals: financeRows.map(({ externalKey, postingNumber, productId, accruedCategory, typeId, amount, accrualDate, raw }) => {
      const skuMarkerIndex = externalKey.lastIndexOf(":sku:");
      const ozonSku = skuMarkerIndex < 0 ? null : externalKey.slice(skuMarkerIndex + 5).split(":", 1)[0];
      return {
        postingId: postingNumber ? postingIdByExternalId.get(postingNumber) ?? null : null,
        productId,
        ozonSku,
        amount,
        category: accruedCategory,
        accrualDate,
        isOzonWriteoffCompensation: isOzonWriteoffCompensation({ typeId, raw }),
        ignored: Boolean(ozonSku && ignoredOzonSkus.has(ozonSku) && !productId),
      };
    }).concat(postingItemRows.flatMap((item) => {
      const posting = postingById.get(item.postingId);
      const buyoutAt = item.marketplaceBuyoutAt ?? posting?.marketplaceBuyoutAt;
      if (!item.isMarketplaceBuyout || item.marketplaceBuyoutAmount === null || !buyoutAt) return [];
      if (item.ozonSku && financeSaleSkuKeys.has(`${item.postingId}\u0000${item.ozonSku}`)) return [];
      return [{
        postingId: item.postingId,
        productId: item.productId,
        ozonSku: item.ozonSku,
        amount: item.marketplaceBuyoutAmount,
        category: "ITEM",
        accrualDate: buyoutAt.toISOString(),
        isOzonWriteoffCompensation: false,
        ignored: dispositionByExternalKey.get(item.externalKey) === "ignored",
      }];
    })),
    returns: returnRows.map(({ externalId, postingNumber, productId, quantity, destination, returnedAt, receivedBySellerAt, availableAtOzon }) => {
      const candidatePostingId = postingNumber ? postingIdByExternalId.get(postingNumber) ?? null : null;
      const postingId = candidatePostingId && productId && postingProductPairs.has(`${candidatePostingId}\u0000${productId}`) ? candidatePostingId : null;
      return {
        externalId,
        postingId,
        productId,
        quantity,
        destination,
        returnedAt: returnedAt?.toISOString() ?? null,
        receivedBySellerAt: receivedBySellerAt?.toISOString() ?? null,
        availableAtOzon: availableAtOzon?.toISOString() ?? null,
      };
    }),
    manualWriteoffs: manualRows.map(({ productId, quantity, writtenOffAt }) => ({ productId, quantity, writtenOffAt })),
    ozonWriteoffs: ozonWriteoffRows.map(({ productId, quantity, occurredAt, compensationStatus, compensationAmount }) => ({
      productId,
      quantity,
      occurredAt: occurredAt?.toISOString() ?? null,
      compensationStatus,
      compensationAmount,
    })),
    stockAdjustments: adjustmentRows.map(({ productId, warehouse, actualQuantity, adjustedAt }) => ({ productId, warehouse, actualQuantity, countedAt: adjustedAt })),
  }, now);

  return {
    ...result,
    products: productRows.map((product) => ({
      ...product,
      ...result.products.find((entry) => entry.productId === product.id),
    })),
    recentExpenses: expenseRows.sort((a, b) => b.spentAt.localeCompare(a.spentAt)).slice(0, 10),
    recentPostings: postingRows.sort((a, b) => (b.deliveredAt?.getTime() ?? 0) - (a.deliveredAt?.getTime() ?? 0)).slice(0, 10),
    recentPurchases: purchaseRows.sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt)).slice(0, 10),
    productRows,
    purchaseRows,
    receiptRows,
    supplyRows: supplyRows.sort((a, b) => b.suppliedAt.localeCompare(a.suppliedAt)),
    supplyLineRows,
    expenseRows: expenseRows.sort((a, b) => b.spentAt.localeCompare(a.spentAt)),
    postingRows: postingRows.sort((a, b) => (b.deliveredAt?.getTime() ?? 0) - (a.deliveredAt?.getTime() ?? 0)),
    postingItemRows,
    returnRows: returnRows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
    manualRows,
    adjustmentRows,
    unresolvedExternalItems: externalRows.filter((item) => item.disposition === "pending").sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime()),
  };
}
