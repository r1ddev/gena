import { desc, eq } from "drizzle-orm";
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
  purchases,
  returns,
  stockAdjustments,
  supplies,
  supplyLines,
} from "@/db/schema";
import { calculateAccounting } from "./accounting";

export async function getAccountingSnapshot(now = new Date()) {
  const [productRows, purchaseRows, receiptRows, supplyRows, supplyLineRows, expenseRows, postingRows, postingItemRows, financeRows, returnRows, manualRows, ozonWriteoffRows, adjustmentRows, externalRows] = await Promise.all([
    db.select().from(products),
    db.select().from(purchases),
    db.select().from(purchaseReceipts),
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
  const productIdByPurchaseId = new Map(purchaseRows.map((purchase) => [purchase.id, purchase.productId]));
  const dispositionByExternalKey = new Map(externalRows.map((item) => [item.externalKey, item.disposition]));
  const itemsByPosting = new Map<string, typeof postingItemRows>();
  for (const item of postingItemRows) itemsByPosting.set(item.postingId, [...(itemsByPosting.get(item.postingId) ?? []), item]);
  const result = calculateAccounting({
    products: productRows.map(({ id, sku, title }) => ({ id, sku, title })),
    purchases: purchaseRows.map(({ id, amountPaid }) => ({ id, amountPaid })),
    receipts: receiptRows.flatMap(({ purchaseId, receivedQuantity, unitCost, receivedAt }) => {
      const productId = productIdByPurchaseId.get(purchaseId);
      return productId ? [{ productId, quantity: receivedQuantity, unitCost, receivedAt }] : [];
    }),
    supplies: [
      ...supplyRows.map((supply) => ({ productId: "", quantity: "0", shippingCost: supply.shippingCost, suppliedAt: supply.suppliedAt })),
      ...supplyLineRows.map((line) => ({ productId: line.productId, quantity: line.quantity, shippingCost: "0", suppliedAt: supplyRows.find((supply) => supply.id === line.supplyId)?.suppliedAt })),
    ],
    expenses: expenseRows.map(({ amount }) => ({ amount })),
    postings: postingRows.map(({ id, status, deliveredAt, marketplaceBuyoutAt, isMarketplaceBuyout }) => ({
      id,
      status,
      deliveredAt: deliveredAt?.toISOString() ?? null,
      marketplaceBuyoutAt: marketplaceBuyoutAt?.toISOString() ?? null,
      isMarketplaceBuyout,
      accountingEnabled: (itemsByPosting.get(id) ?? []).length > 0 && (itemsByPosting.get(id) ?? []).every((item) => item.productId !== null && dispositionByExternalKey.get(item.externalKey) !== "ignored"),
    })),
    postingItems: postingItemRows.map(({ postingId, externalKey, productId, quantity, price, movementEnabled }) => ({
      postingId,
      productId,
      quantity,
      price,
      movementEnabled,
      ignored: dispositionByExternalKey.get(externalKey) === "ignored",
    })),
    financeAccruals: financeRows.map(({ postingNumber, productId, accruedCategory, amount }) => ({
      postingId: postingNumber ? postingIdByExternalId.get(postingNumber) ?? null : null,
      productId,
      amount,
      category: accruedCategory,
    })),
    returns: returnRows.map(({ postingNumber, productId, quantity, destination, returnedAt, receivedBySellerAt, availableAtOzon }) => ({
      postingId: postingNumber ? postingIdByExternalId.get(postingNumber) ?? null : null,
      productId,
      quantity,
      destination,
      returnedAt: returnedAt?.toISOString() ?? null,
      receivedBySellerAt: receivedBySellerAt?.toISOString() ?? null,
      availableAtOzon: availableAtOzon?.toISOString() ?? null,
    })),
    manualWriteoffs: manualRows.map(({ productId, quantity, writtenOffAt }) => ({ productId, quantity, writtenOffAt })),
    ozonWriteoffs: ozonWriteoffRows.map(({ productId, quantity, occurredAt }) => ({ productId, quantity, occurredAt: occurredAt?.toISOString() ?? null })),
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
