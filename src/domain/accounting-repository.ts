import { desc, eq, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db";
import {
  appSettings,
  expenses,
  externalItems,
  financeAccruals,
  manualWriteoffs,
  ozonPayouts,
  ozonCompensationReports,
  ozonWriteoffs,
  postingItems,
  postings,
  productLinks,
  products,
  purchaseReceipts,
  purchaseReceiptLines,
  purchases,
  returns,
  stockAdjustments,
  supplies,
  supplyLines,
} from "@/db/schema";
import { calculateAccounting, hasAccountablePostingItems, type AccountingInput } from "./accounting";
import { calculateAddedCostHistoryByPosting } from "./added-cost-history";
import type { AddedCostBreakdown, AddedCostHistoryOperation } from "./added-cost-history";
import { resolveOzonReturnTimeline } from "@/ozon/return-status";
import { calculateFinalPostingProfits, isDeliveredPostingStatus, isFinalPostingStatus } from "./order-profit";
import { calculateProductProfitDays } from "./product-profit-trend";
import { currentOrderStatus, getOrderReturnStatesByPosting, hasRestockedReturn } from "./order-return-state";
import { buildFinanceOrderSkuPostingMap, buildFinancePostingProductIdentifiers, financeAccrualRelatedOfferIds, financeAccrualRelatedSkus, financePostingSaleSkus, isOzonBuyerOrderAccrual, isOzonSharedExpense, isOzonWriteoffCompensation, ozonExpenseLabel, resolveFinanceAccrualPostingNumber } from "@/ozon/finance";
import { isOzonWriteOffStatus } from "@/ozon/return-status";
import { buildCatalogProductWhitelist, isCatalogProduct, isFinanceRowOutsideCatalog, resolveCatalogProductId } from "@/ozon/catalog-whitelist";
import { matchOzonCompensationReports } from "@/ozon/compensation";

export async function getAccountingSnapshot(userId: string, now = new Date(), includeAddedCostRates = false, includeFullDailyTrend = false) {
  const [productRows, purchaseRows, receiptRows, receiptLineRows, supplyRows, supplyLineRows, expenseRows, postingRows, postingItemRows, financeRows, compensationReports, returnRows, manualRows, ozonWriteoffRows, adjustmentRows, externalRows, payoutRows, settingsRows, catalogLinkRows] = await Promise.all([
    db.select().from(products).where(eq(products.userId, userId)),
    db.select().from(purchases).where(eq(purchases.userId, userId)),
    db.select().from(purchaseReceipts).where(eq(purchaseReceipts.userId, userId)),
    db.select().from(purchaseReceiptLines).where(eq(purchaseReceiptLines.userId, userId)),
    db.select().from(supplies).where(eq(supplies.userId, userId)),
    db.select().from(supplyLines).where(eq(supplyLines.userId, userId)),
    db.select().from(expenses).where(eq(expenses.userId, userId)),
    db.select().from(postings).where(eq(postings.userId, userId)),
    db.select().from(postingItems).where(eq(postingItems.userId, userId)),
    db.select().from(financeAccruals).where(eq(financeAccruals.userId, userId)),
    db.select().from(ozonCompensationReports).where(eq(ozonCompensationReports.userId, userId)),
    db.select().from(returns).where(eq(returns.userId, userId)),
    db.select().from(manualWriteoffs).where(eq(manualWriteoffs.userId, userId)),
    db.select().from(ozonWriteoffs).where(eq(ozonWriteoffs.userId, userId)),
    db.select().from(stockAdjustments).where(eq(stockAdjustments.userId, userId)),
    db.select().from(externalItems).where(eq(externalItems.userId, userId)),
    db.select().from(ozonPayouts).where(eq(ozonPayouts.userId, userId)),
    db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1),
    db.select().from(productLinks).where(eq(productLinks.userId, userId)),
  ]);

  const catalogWhitelist = buildCatalogProductWhitelist(productRows, catalogLinkRows, externalRows);
  const accountingStartDate = settingsRows[0]?.accountingStartDate ?? "0000-01-01";
  const compensationByAccrual = matchOzonCompensationReports(financeRows, compensationReports);
  const currentCatalogProductIds = catalogWhitelist.productIds;
  const allFinancePostingByOrderSku = buildFinanceOrderSkuPostingMap(postingRows, postingItemRows);
  const financePostingProductIdentifiers = buildFinancePostingProductIdentifiers(postingRows, postingItemRows);
  const catalogPostingItemRows = postingItemRows.flatMap((item) => {
    const productId = resolveCatalogProductId(catalogWhitelist, item);
    return productId ? [{ ...item, productId }] : [];
  });
  const catalogPostingIds = new Set(catalogPostingItemRows.map((item) => item.postingId));
  const visibleProductRows = productRows.filter((product) => currentCatalogProductIds.has(product.id));
  const visiblePurchaseRows = purchaseRows.filter((purchase) => currentCatalogProductIds.has(purchase.productId));
  const visiblePurchaseIds = new Set(visiblePurchaseRows.map((purchase) => purchase.id));
  const visibleReceiptRows = receiptRows.filter((receipt) => visiblePurchaseIds.has(receipt.purchaseId));
  const visibleReceiptIds = new Set(visibleReceiptRows.map((receipt) => receipt.id));
  const visibleReceiptLineRows = receiptLineRows.filter((line) =>
    visibleReceiptIds.has(line.receiptId) && currentCatalogProductIds.has(line.productId),
  );
  const visibleSupplyLineRows = supplyLineRows.filter((line) => currentCatalogProductIds.has(line.productId));
  const visibleSupplyIds = new Set(visibleSupplyLineRows.map((line) => line.supplyId));
  const visibleSupplyRows = supplyRows.filter((supply) => visibleSupplyIds.has(supply.id));
  const visiblePostingRows = postingRows.filter((posting) => catalogPostingIds.has(posting.id));
  const visiblePostingIds = new Set(visiblePostingRows.map((posting) => posting.id));
  const visiblePostingItemRows = catalogPostingItemRows.filter((item) => visiblePostingIds.has(item.postingId));
  const visiblePostingNumbers = new Set(visiblePostingRows.map((posting) => posting.externalId));
  const knownPostingNumbers = new Set(postingRows.map((posting) => posting.externalId));
  const visibleFinanceRows = financeRows.filter((row) => {
    if (row.accrualDate < accountingStartDate) return false;
    const compensationDetails = compensationByAccrual.get(row.externalKey) ?? [];
    const postingNumber = resolveFinanceAccrualPostingNumber(row, allFinancePostingByOrderSku);
    if (postingNumber && knownPostingNumbers.has(postingNumber) && !visiblePostingNumbers.has(postingNumber) && !compensationDetails.length) return false;
    const relatedSkus = [...new Set([
      ...financeAccrualRelatedSkus(row),
      ...compensationDetails.map((line) => line.ozonSku).filter(Boolean),
    ])];
    const relatedOfferIds = [...new Set([
      ...financeAccrualRelatedOfferIds(row),
      ...compensationDetails.map((line) => line.offerId).filter(Boolean),
    ])];
    if (compensationDetails.some((line) => !line.ozonSku && !line.offerId)) return true;
    if (isFinanceRowOutsideCatalog(
      catalogWhitelist,
      { ...row, relatedSkus, raw: { ...row.raw, offer_id: relatedOfferIds } },
      postingNumber ? financePostingProductIdentifiers.get(postingNumber) : undefined,
    )) return false;
    return true;
  });
  const visibleReturnRows = returnRows.flatMap((row) => {
    const rawProduct = row.raw.product && typeof row.raw.product === "object" && !Array.isArray(row.raw.product)
      ? row.raw.product as Record<string, unknown>
      : {};
    const productId = resolveCatalogProductId(catalogWhitelist, {
      productId: row.productId,
      offerId: row.offerId || String(rawProduct.offer_id ?? ""),
      ozonSku: row.ozonSku || String(rawProduct.sku ?? ""),
      externalKey: row.externalKey,
    });
    return productId && (!row.postingNumber || !knownPostingNumbers.has(row.postingNumber) || visiblePostingNumbers.has(row.postingNumber))
      ? [{ ...row, productId }]
      : [];
  });
  const returnStatesByPosting = getOrderReturnStatesByPosting(
    visiblePostingRows.map(({ id, externalId }) => ({ id, externalId })),
    visibleReturnRows,
  );
  const visibleManualRows = manualRows.filter((row) => currentCatalogProductIds.has(row.productId));
  const visibleOzonWriteoffRows = ozonWriteoffRows.flatMap((row) => {
    const rawProduct = row.raw.product && typeof row.raw.product === "object" && !Array.isArray(row.raw.product)
      ? row.raw.product as Record<string, unknown>
      : {};
    const productId = resolveCatalogProductId(catalogWhitelist, {
      productId: row.productId,
      offerId: row.offerId || String(rawProduct.offer_id ?? ""),
      ozonSku: row.ozonSku || String(rawProduct.sku ?? ""),
      externalKey: row.externalKey,
    });
    return productId ? [{ ...row, productId }] : [];
  });
  const visibleAdjustmentRows = adjustmentRows.filter((row) => currentCatalogProductIds.has(row.productId));

  const postingIdByExternalId = new Map(visiblePostingRows.map((posting) => [posting.externalId, posting.id]));
  const postingById = new Map(visiblePostingRows.map((posting) => [posting.id, posting]));
  const productById = new Map(visibleProductRows.map((product) => [product.id, product]));
  const financePostingByOrderSku = buildFinanceOrderSkuPostingMap(visiblePostingRows, visiblePostingItemRows);
  const financeSaleSkuKeys = new Set(visibleFinanceRows.flatMap((row) => {
    const postingNumber = resolveFinanceAccrualPostingNumber(row, financePostingByOrderSku);
    const postingId = postingNumber ? postingIdByExternalId.get(postingNumber) : null;
    return postingId ? financePostingSaleSkus(row.raw).map((sku) => `${postingId}\u0000${sku}`) : [];
  }));
  const postingProductPairs = new Set(visiblePostingItemRows.flatMap((item) => item.productId ? [`${item.postingId}\u0000${item.productId}`] : []));
  const purchaseById = new Map(visiblePurchaseRows.map((purchase) => [purchase.id, purchase]));
  const receiptById = new Map(visibleReceiptRows.map((receipt) => [receipt.id, receipt]));
  const effectiveReceiptIds = new Set(visibleReceiptRows.filter((receipt) => Date.parse(`${receipt.receivedAt}T00:00:00.000Z`) <= now.getTime()).map((receipt) => receipt.id));
  const receivedQuantityByPurchase = new Map<string, Decimal>();
  for (const line of visibleReceiptLineRows) {
    if (!effectiveReceiptIds.has(line.receiptId)) continue;
    const purchaseId = receiptById.get(line.receiptId)?.purchaseId;
    if (!purchaseId) continue;
    receivedQuantityByPurchase.set(purchaseId, (receivedQuantityByPurchase.get(purchaseId) ?? new Decimal(0)).plus(line.quantity));
  }
  const itemsByPosting = new Map<string, typeof visiblePostingItemRows>();
  for (const item of visiblePostingItemRows) itemsByPosting.set(item.postingId, [...(itemsByPosting.get(item.postingId) ?? []), item]);
  const accountingInput: AccountingInput = {
    products: visibleProductRows.map(({ id, sku, title }) => ({ id, sku, title })),
    purchases: visiblePurchaseRows.map(({ id, amountPaid, productTitleSnapshot, productSkuSnapshot }) => ({
      id,
      amountPaid,
      sourceLabel: productTitleSnapshot || productSkuSnapshot || "товар без названия",
    })),
    receipts: visibleReceiptLineRows.flatMap((line) => {
      const receipt = receiptById.get(line.receiptId);
      if (!receipt || !effectiveReceiptIds.has(receipt.id)) return [];
      const purchase = purchaseById.get(receipt.purchaseId);
      const totalReceived = receivedQuantityByPurchase.get(receipt.purchaseId);
      if (!purchase || !totalReceived || totalReceived.isZero()) return [];
      const unitCost = new Decimal(purchase.amountPaid).div(totalReceived).toString();
      const product = productById.get(line.productId);
      return [{
        productId: line.productId,
        quantity: line.quantity,
        unitCost,
        includeInAverageCost: purchase.status === "completed",
        receivedAt: receipt.receivedAt,
        productSku: line.productSkuSnapshot || product?.sku,
        productTitle: line.productTitleSnapshot || product?.title,
        purchaseId: purchase.id,
        purchaseDate: purchase.purchasedAt,
        purchaseNote: purchase.note,
        receiptNote: receipt.note,
      }];
    }),
    supplies: [
      // The displayed delivery amount mirrors Ozon type 12; finance accruals remain the single expense source.
      ...visibleSupplyRows.map((supply) => ({ productId: "", quantity: "0", shippingCost: supply.shippingCost, suppliedAt: supply.suppliedAt })),
      ...visibleSupplyLineRows.map((line) => ({ productId: line.productId, quantity: line.quantity, shippingCost: "0", suppliedAt: visibleSupplyRows.find((supply) => supply.id === line.supplyId)?.suppliedAt })),
    ],
    expenses: expenseRows.map(({ amount, spentAt, description, note }) => ({ amount, spentAt, sourceLabel: description, note })),
    ozonSharedExpenses: visibleFinanceRows.flatMap((row) => {
      const postingNumber = resolveFinanceAccrualPostingNumber(row, financePostingByOrderSku);
      if (!isOzonSharedExpense({ postingNumber, category: row.accruedCategory, typeId: row.typeId, raw: row.raw })) return [];
      return [{
        amount: row.amount,
        spentAt: row.accrualDate,
        sourceLabel: ozonExpenseLabel(row.typeId, row.raw, row.accruedCategory),
        typeId: row.typeId,
        unitNumber: typeof row.raw.unit_number === "string" ? row.raw.unit_number : "",
        externalKey: row.externalKey,
      }];
    }),
    postings: visiblePostingRows.map(({ id, status, deliveredAt, marketplaceBuyoutAt, isMarketplaceBuyout, externalId, orderNumber, orderDate }) => ({
      id,
      status,
      deliveredAt: deliveredAt?.toISOString() ?? null,
      marketplaceBuyoutAt: marketplaceBuyoutAt?.toISOString() ?? null,
      isMarketplaceBuyout,
      externalId,
      orderNumber,
      orderDate: orderDate?.toISOString() ?? null,
      accountingEnabled: hasAccountablePostingItems((itemsByPosting.get(id) ?? []).map((item) => ({
        productId: item.productId,
        ignored: false,
      }))),
    })),
    postingItems: visiblePostingItemRows.map(({ postingId, externalKey, productId, quantity, price, movementEnabled, ozonSku, isMarketplaceBuyout, marketplaceBuyoutAt, offerId, title }) => ({
      postingId,
      productId,
      quantity,
      price,
      movementEnabled,
      ozonSku,
      offerId,
      title,
      isMarketplaceBuyout,
      marketplaceBuyoutAt: marketplaceBuyoutAt?.toISOString() ?? null,
        ignored: false,
    })),
    financeAccruals: visibleFinanceRows.map((row) => {
      const { externalKey, productId, accruedCategory, typeId, amount, accrualDate, raw } = row;
      const ozonSku = externalKey.match(/(?:^|[|:])sku:([^:|]+)/)?.[1] ?? null;
      const postingNumber = resolveFinanceAccrualPostingNumber(row, financePostingByOrderSku);
      const isWriteoffCompensation = isOzonWriteoffCompensation({ typeId, raw });
      const category = accruedCategory.toUpperCase();
      const isOrderAccrual = isOzonBuyerOrderAccrual({ postingNumber, category: accruedCategory, typeId });
      return {
        postingId: postingNumber ? postingIdByExternalId.get(postingNumber) ?? null : null,
        productId,
        ozonSku,
        amount,
        category: accruedCategory,
        accrualDate,
        isOzonWriteoffCompensation: isWriteoffCompensation,
        ignored: false,
        sourceGroup: isWriteoffCompensation ? "compensation" as const : isOrderAccrual ? "orders" as const : "shared" as const,
        sourceLabel: ozonExpenseLabel(typeId, raw, accruedCategory),
      };
    }).concat(visiblePostingItemRows.flatMap((item) => {
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
        ignored: false,
        sourceGroup: "orders" as const,
        sourceLabel: "Выручка от выкупа",
      }];
    })),
    returns: visibleReturnRows.map(({ externalId, postingNumber, productId, quantity, destination, returnedAt, receivedBySellerAt, writtenOffAt, availableAtOzon, status, note }) => {
      const candidatePostingId = postingNumber ? postingIdByExternalId.get(postingNumber) ?? null : null;
      const postingId = candidatePostingId && productId && postingProductPairs.has(`${candidatePostingId}\u0000${productId}`) ? candidatePostingId : null;
      const product = productId ? productById.get(productId) : undefined;
      return {
        externalId,
        postingId,
        productId,
        quantity,
        destination,
        returnedAt: returnedAt?.toISOString() ?? null,
        receivedBySellerAt: receivedBySellerAt?.toISOString() ?? null,
        writtenOffAt: writtenOffAt?.toISOString() ?? null,
        availableAtOzon: availableAtOzon?.toISOString() ?? null,
        postingNumber,
        productSku: product?.sku,
        productTitle: product?.title,
        status,
        note,
      };
    }),
    manualWriteoffs: visibleManualRows.map(({ productId, quantity, writtenOffAt, productSkuSnapshot, productTitleSnapshot, note }) => ({
      productId,
      quantity,
      writtenOffAt,
      productSku: productSkuSnapshot,
      productTitle: productTitleSnapshot,
      note,
    })),
    ozonWriteoffs: visibleOzonWriteoffRows.map(({ externalId, productId, quantity, occurredAt, compensationStatus, compensationAmount, ozonSku }) => ({
      externalId,
      productId,
      quantity,
      occurredAt: occurredAt?.toISOString() ?? null,
      compensationStatus,
      compensationAmount,
      productSku: productId ? productById.get(productId)?.sku : ozonSku,
      productTitle: productId ? productById.get(productId)?.title : undefined,
    })),
    stockAdjustments: visibleAdjustmentRows.map(({ productId, warehouse, actualQuantity, adjustedAt }) => ({ productId, warehouse, actualQuantity, countedAt: adjustedAt })),
  };
  const ozonSellerReturnAtById = new Map(visibleReturnRows.flatMap((row) => {
    if (row.destination !== "seller") return [];
    const timeline = resolveOzonReturnTimeline(row.raw);
    return timeline.finalStatus === "seller" && timeline.receivedBySellerAt
      ? [[row.externalId, timeline.receivedBySellerAt.toISOString()] as const]
      : [];
  }));
  const addedCostInput: AccountingInput = {
    ...accountingInput,
    returns: accountingInput.returns.map((returned) => ({
      ...returned,
      receivedBySellerAt: returned.destination === "seller"
        ? ozonSellerReturnAtById.get(returned.externalId ?? "") ?? returned.receivedBySellerAt
        : returned.receivedBySellerAt,
    })),
  };
  const addedCostHistoryByPostingId = includeAddedCostRates
    ? calculateAddedCostHistoryByPosting(addedCostInput, now)
    : undefined;
  const addedCostRateByPostingId = addedCostHistoryByPostingId
    ? Object.fromEntries(addedCostHistoryByPostingId.rates)
    : undefined;
  const addedCostBreakdownByPostingId = addedCostHistoryByPostingId
    ? Object.fromEntries(addedCostHistoryByPostingId.breakdowns)
    : undefined;
  const addedCostOperations = addedCostHistoryByPostingId?.operations;
  const result = calculateAccounting(accountingInput, now);

  // Use the same per-posting calculation shown in "Продажи и заказы".
  const orderAmountCentsByPosting = new Map(visiblePostingRows.map((posting) => [posting.externalId, 0]));
  const saleSkusByPosting = new Map<string, Set<string>>();
  for (const accrual of visibleFinanceRows) {
    const postingNumber = resolveFinanceAccrualPostingNumber(accrual, financePostingByOrderSku);
    if (!postingNumber) continue;
    orderAmountCentsByPosting.set(postingNumber, (orderAmountCentsByPosting.get(postingNumber) ?? 0) + Math.round(Number(accrual.amount) * 100));
    const skus = financePostingSaleSkus(accrual.raw);
    if (skus.length) saleSkusByPosting.set(postingNumber, new Set([...(saleSkusByPosting.get(postingNumber) ?? []), ...skus]));
  }
  for (const item of visiblePostingItemRows) {
    const posting = postingById.get(item.postingId);
    if (!posting || (item.ozonSku && saleSkusByPosting.get(posting.externalId)?.has(item.ozonSku))) continue;
    orderAmountCentsByPosting.set(posting.externalId, (orderAmountCentsByPosting.get(posting.externalId) ?? 0) + Math.round(Number(item.marketplaceBuyoutAmount ?? 0) * 100));
  }
  const unitCostByProduct = new Map(result.products.map((product) => [product.productId, product.landedUnitCostExact ?? product.landedUnitCost]));
  const profitByPosting = calculateFinalPostingProfits({
    postings: visiblePostingRows,
    items: visiblePostingItemRows.map((item) => ({
      postingId: item.postingId,
      productId: item.productId,
      quantity: item.quantity,
      movementEnabled: item.movementEnabled,
    })),
    returns: visibleReturnRows.flatMap((returned) => returned.postingNumber && returned.productId && hasRestockedReturn(returned)
      ? [{ postingNumber: returned.postingNumber, productId: returned.productId, quantity: returned.quantity }]
      : []),
    writeoffs: visibleReturnRows.flatMap((returned) => returned.postingNumber && returned.productId && returned.writtenOffAt && !isOzonWriteOffStatus(returned.status, returned.raw)
      ? [{ postingNumber: returned.postingNumber, productId: returned.productId, quantity: returned.quantity }]
      : []),
    amountCentsByPosting: orderAmountCentsByPosting,
    unitCostByProduct,
  });
  const dateKey = (date: Date) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
  };
  const today = dateKey(now);
  const [year, month, day] = today.split("-").map(Number);
  const configuredStartParts = includeFullDailyTrend ? accountingStartDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)?.slice(1).map(Number) : undefined;
  const configuredStartIsValid = Boolean(configuredStartParts && configuredStartParts[0] >= 2000 && accountingStartDate <= today);
  const trendStart = configuredStartIsValid && configuredStartParts
    ? new Date(Date.UTC(configuredStartParts[0], configuredStartParts[1] - 1, configuredStartParts[2]))
    : new Date(Date.UTC(year, month - 1, day - 29));
  const dayCount = Math.max(1, Math.floor((Date.UTC(year, month - 1, day) - trendStart.getTime()) / 86_400_000) + 1);
  const trendDays = Array.from({ length: includeFullDailyTrend ? dayCount : 30 }, (_, index) => {
    const date = new Date(trendStart);
    date.setUTCDate(trendStart.getUTCDate() + index);
    const dateString = date.toISOString().slice(0, 10);
    return { date: dateString, sentUnits: 0, purchasedUnits: 0, profitCents: 0, incompleteProfitCount: 0 };
  });
  const trendByDate = new Map(trendDays.map((entry) => [entry.date, entry]));
  const unitsByPosting = new Map<string, Decimal>();
  for (const item of postingItemRows) {
    if (!visiblePostingIds.has(item.postingId)) continue;
    const quantity = new Decimal(item.quantity);
    if (!quantity.isFinite() || !quantity.gt(0)) continue;
    unitsByPosting.set(item.postingId, (unitsByPosting.get(item.postingId) ?? new Decimal(0)).plus(quantity));
  }
  for (const posting of visiblePostingRows) {
    if (!posting.orderDate) continue;
    const orderDay = dateKey(posting.orderDate);
    const day = trendByDate.get(orderDay);
    if (!day) continue;
    const units = unitsByPosting.get(posting.id) ?? new Decimal(0);
    day.sentUnits += units.toNumber();
    if (currentOrderStatus(posting.status, returnStatesByPosting.get(posting.externalId)) === "Доставлен") {
      day.purchasedUnits += units.toNumber();
    }
    const isFinal = isFinalPostingStatus(posting.status);
    if (!isFinal) continue;
    const profit = profitByPosting.get(posting.externalId)?.profitCents;
    if (profit === null || profit === undefined) day.incompleteProfitCount += 1;
    else day.profitCents += profit;
  }
  const dailyTrend = {
    days: trendDays,
    incompleteProfitCount: trendDays.reduce((total, entry) => total + entry.incompleteProfitCount, 0),
  };
  const productProfitDays = includeFullDailyTrend && addedCostHistoryByPostingId
    ? calculateProductProfitDays({
      saleDays: addedCostHistoryByPostingId.operations.flatMap((operation) => operation.kind === "sale" && operation.postingId
        ? [{ postingId: operation.postingId, date: dateKey(new Date(operation.occurredAt)) }]
        : []),
      items: accountingInput.postingItems,
      accruals: accountingInput.financeAccruals,
      now,
      returns: visibleReturnRows.flatMap((returned) => {
        const postingId = returned.postingNumber ? postingIdByExternalId.get(returned.postingNumber) : null;
        const restockedAt = returned.destination === "seller" ? returned.receivedBySellerAt : returned.availableAtOzon;
        return postingId && returned.productId
          ? [{ postingId, productId: returned.productId, quantity: returned.quantity, restocked: Boolean(restockedAt && restockedAt <= now && hasRestockedReturn(returned)) }]
          : [];
      }),
      averageUnitCostByProduct: unitCostByProduct,
      saleCostsByPostingProduct: addedCostHistoryByPostingId.saleCostsByPostingProduct,
    })
    : undefined;
  const finalizedOrderProfitCents = [...profitByPosting.values()].reduce((total, result) => total + (result.profitCents ?? 0), 0);
  const orderProfitIncompleteCount = [...profitByPosting.values()].filter((result) => result.missingCost).length;

  const paidPayoutRows = payoutRows.filter((payout) =>
    !new Decimal(payout.amount).isZero() && payout.periodEnd >= accountingStartDate && !payout.excludedFromAccounting,
  );
  const payoutByCurrency = new Map<string, Decimal>();
  for (const payout of paidPayoutRows) {
    const currencyCode = payout.currencyCode.toUpperCase();
    payoutByCurrency.set(currencyCode, (payoutByCurrency.get(currencyCode) ?? new Decimal(0)).plus(payout.amount));
  }
  const payoutRoubles = payoutByCurrency.get("RUB") ?? new Decimal(0);
  const purchaseOutflow = visiblePurchaseRows.reduce((total, purchase) => total.plus(purchase.amountPaid), new Decimal(0));
  const effectiveExpenseRows = expenseRows.filter((expense) => Date.parse(`${expense.spentAt}T00:00:00.000Z`) <= now.getTime());
  const manualExpenseOutflow = effectiveExpenseRows.reduce((total, expense) => total.plus(expense.amount), new Decimal(0));
  const settingsRow = settingsRows[0];
  const payoutHistoryLoaded = Boolean(settingsRow?.accountingStartDate && settingsRow.ozonPayoutHistoryStartDate === settingsRow.accountingStartDate);
  const unsupportedPayoutCurrencies = [...payoutByCurrency.keys()].filter((currencyCode) => currencyCode !== "RUB");
  const actualCashTotal = payoutHistoryLoaded && unsupportedPayoutCurrencies.length === 0
    ? payoutRoubles.minus(purchaseOutflow).minus(manualExpenseOutflow).toFixed(2)
    : null;

  return {
    ...result,
    ...(addedCostRateByPostingId ? { addedCostRateByPostingId } : {}),
    ...(addedCostBreakdownByPostingId ? { addedCostBreakdownByPostingId } : {}),
    ...(addedCostOperations ? { addedCostOperations } : {}),
    ...(productProfitDays ? { productProfitDays } : {}),
    profitBreakdown: {
      ...result.profitBreakdown,
      orderProfit: (finalizedOrderProfitCents / 100).toFixed(2),
      orderProfitIncompleteCount,
    },
    dailyTrend,
    actualCash: {
      payouts: [...payoutByCurrency.entries()].map(([currencyCode, amount]) => ({ currencyCode, amount: amount.toFixed(2) })),
      purchases: purchaseOutflow.toFixed(2),
      expenses: manualExpenseOutflow.toFixed(2),
      total: actualCashTotal,
      loaded: payoutHistoryLoaded,
      periods: new Set(paidPayoutRows.map((payout) => payout.periodId)).size,
      unsupportedCurrencies: unsupportedPayoutCurrencies,
    },
    products: visibleProductRows.map((product) => ({
      ...product,
      ...result.products.find((entry) => entry.productId === product.id),
    })),
    recentExpenses: expenseRows.sort((a, b) => b.spentAt.localeCompare(a.spentAt)).slice(0, 10),
    recentPostings: [...visiblePostingRows]
      .sort((a, b) => (b.deliveredAt?.getTime() ?? 0) - (a.deliveredAt?.getTime() ?? 0))
      .slice(0, 10)
      .map((posting) => {
        const returnState = returnStatesByPosting.get(posting.externalId) ?? null;
        return { ...posting, status: currentOrderStatus(posting.status, returnState), returnState };
      }),
    recentPurchases: visiblePurchaseRows.sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt)).slice(0, 10),
    productRows: visibleProductRows,
    purchaseRows: visiblePurchaseRows,
    receiptRows: visibleReceiptRows,
    supplyRows: visibleSupplyRows.sort((a, b) => b.suppliedAt.localeCompare(a.suppliedAt)),
    supplyLineRows: visibleSupplyLineRows,
    expenseRows: expenseRows.sort((a, b) => b.spentAt.localeCompare(a.spentAt)),
    postingRows: visiblePostingRows.sort((a, b) => (b.deliveredAt?.getTime() ?? 0) - (a.deliveredAt?.getTime() ?? 0)),
    postingItemRows: visiblePostingItemRows,
    returnRows: visibleReturnRows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
    manualRows: visibleManualRows,
    adjustmentRows: visibleAdjustmentRows,
    unresolvedExternalItems: externalRows.filter((item) => item.disposition === "pending" && isCatalogProduct(catalogWhitelist, item)).sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime()),
  };
}

export async function persistAddedCostRateSnapshots(userId: string, snapshot: {
  postingRows: { id: string }[];
  addedCostRateByPostingId?: Record<string, string>;
  addedCostBreakdownByPostingId?: Record<string, AddedCostBreakdown>;
}) {
  if (!snapshot.postingRows.length) return 0;
  const values = snapshot.postingRows.map((posting) => [
    posting.id,
    snapshot.addedCostRateByPostingId?.[posting.id] ?? null,
    snapshot.addedCostBreakdownByPostingId?.[posting.id]
      ? JSON.stringify(snapshot.addedCostBreakdownByPostingId[posting.id])
      : null,
  ] as const);
  for (let offset = 0; offset < values.length; offset += 500) {
    const batch = values.slice(offset, offset + 500);
    const tuples = batch.map(([id, rate, breakdown]) => sql`(${id}::uuid, ${rate}::numeric, ${breakdown}::jsonb)`);
    await db.execute(sql`
      UPDATE ozon_postings AS posting
      SET added_cost_rate_percent = rates.rate,
          added_cost_breakdown = rates.breakdown
      FROM (VALUES ${sql.join(tuples, sql`, `)}) AS rates(id, rate, breakdown)
      WHERE posting.id = rates.id
        AND posting.user_id = ${userId}::uuid
        AND (posting.added_cost_rate_percent IS DISTINCT FROM rates.rate
          OR posting.added_cost_breakdown IS DISTINCT FROM rates.breakdown)
    `);
  }
  return Object.keys(snapshot.addedCostRateByPostingId ?? {}).length;
}
