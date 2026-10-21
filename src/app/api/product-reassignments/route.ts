import { and, desc, eq, or, sql, type SQLWrapper } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  externalItems,
  financeAccruals,
  manualWriteoffs,
  ozonWriteoffs,
  postingItems,
  productImages,
  productLinks,
  products,
  purchaseReceiptLines,
  purchases,
  returns,
  stockAdjustments,
  stocktakeLines,
  supplyLines,
} from "@/db/schema";
import { assertLocalMutation, errorResponse, handleLocalGet, parseBody } from "../_lib/http";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("map"), productId: z.string().uuid() }),
  z.object({ action: z.literal("create") }),
]);

const referenceCounts = (productId: SQLWrapper | string) => ({
  purchases: sql<number>`(select count(*)::int from purchases where product_id = ${productId})`,
  purchaseReceipts: sql<number>`(select count(*)::int from purchase_receipt_lines where product_id = ${productId})`,
  supplies: sql<number>`(select count(*)::int from supply_lines where product_id = ${productId})`,
  orders: sql<number>`(select count(*)::int from ozon_posting_items where product_id = ${productId})`,
  accruals: sql<number>`(select count(*)::int from ozon_finance_accruals where product_id = ${productId})`,
  returns: sql<number>`(select count(*)::int from ozon_returns where product_id = ${productId})`,
  manualWriteoffs: sql<number>`(select count(*)::int from manual_writeoffs where product_id = ${productId})`,
  ozonWriteoffs: sql<number>`(select count(*)::int from ozon_writeoffs where product_id = ${productId})`,
  stocktakes: sql<number>`(select count(*)::int from stocktake_lines where product_id = ${productId})`,
  stockAdjustments: sql<number>`(select count(*)::int from stock_adjustments where product_id = ${productId})`,
  ozonLinks: sql<number>`(select count(*)::int from external_items where product_id = ${productId})`,
});

const referenceLabels: Record<string, string> = {
  purchases: "Закупки",
  purchaseReceipts: "Приёмки закупок",
  supplies: "Поставки на Ozon",
  orders: "Заказы",
  accruals: "Денежные операции Ozon",
  returns: "Возвраты",
  manualWriteoffs: "Списания продавцом",
  ozonWriteoffs: "Списания Ozon",
  stocktakes: "Инвентаризации",
  stockAdjustments: "Корректировки остатков",
  ozonLinks: "Связанные записи Ozon",
};

function productLinkIdentifiers(offerId: string, ozonSku: string) {
  return [offerId ? eq(productLinks.offerId, offerId) : undefined, ozonSku ? eq(productLinks.ozonSku, ozonSku) : undefined]
    .filter((condition): condition is NonNullable<typeof condition> => condition !== undefined);
}

export async function GET(request: Request) {
  return handleLocalGet(request, async () => {
    const items = await db.select({
      id: products.id,
      title: products.title,
      sku: products.sku,
      offerId: products.reassignmentOfferId,
      ozonSku: products.reassignmentOzonSku,
      createdAt: products.updatedAt,
      imageAvailable: sql<boolean>`exists (select 1 from product_images where product_id = ${products.id})`,
      ...referenceCounts(products.id),
    }).from(products)
      .where(eq(products.reassignmentPending, true))
      .orderBy(desc(products.updatedAt));

    return {
      items: items.map((item) => {
        const blockers = Object.entries(referenceLabels).flatMap(([key, label]) => {
          const count = Number(item[key as keyof typeof item] ?? 0);
          return count > 0 ? [{ key, label, count }] : [];
        });
        return {
          ...item,
          imageUrl: item.imageAvailable ? `/api/products/${item.id}/image` : null,
          blockers,
          operationCount: blockers.reduce((total, blocker) => total + blocker.count, 0),
        };
      }),
    };
  });
}

export async function PATCH(request: Request) {
  try {
    assertLocalMutation(request);
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    const body = await parseBody(request, actionSchema);
    const result = await db.transaction(async (tx) => {
      const [former] = await tx.select().from(products).where(and(eq(products.id, id), eq(products.reassignmentPending, true))).for("update").limit(1);
      if (!former) throw new Error("Товар не найден в списке перераспределения.");

      let targetId = body.action === "map" ? body.productId : "";
      let disposition: "mapped" | "created" = body.action === "map" ? "mapped" : "created";
      if (body.action === "create") {
        const identifiers = productLinkIdentifiers(former.reassignmentOfferId, former.reassignmentOzonSku);
        const hasCompleteOzonLink = Boolean(former.reassignmentOfferId && former.reassignmentOzonSku);
        const duplicateLinks = identifiers.length
          ? await tx.select({ id: productLinks.id }).from(productLinks).where(or(...identifiers)).limit(1)
          : [];
        if (duplicateLinks.length) throw new Error("Артикул или SKU Ozon уже связан с другим товаром. Сопоставьте записи с ним.");
        const [created] = await tx.insert(products).values({ sku: former.sku, title: former.title }).returning({ id: products.id });
        targetId = created.id;
        if (hasCompleteOzonLink) {
          await tx.insert(productLinks).values({ productId: targetId, offerId: former.reassignmentOfferId, ozonSku: former.reassignmentOzonSku });
        }
        const [image] = await tx.select().from(productImages).where(eq(productImages.productId, id)).limit(1);
        if (image) await tx.insert(productImages).values({ productId: targetId, contentType: image.contentType, data: image.data });
      } else {
        const [target] = await tx.select({ id: products.id }).from(products)
          .where(and(eq(products.id, targetId), eq(products.reassignmentPending, false))).limit(1);
        if (!target) throw new Error("Выбранный товар не найден в каталоге.");

        const identifiers = productLinkIdentifiers(former.reassignmentOfferId, former.reassignmentOzonSku);
        const hasCompleteOzonLink = Boolean(former.reassignmentOfferId && former.reassignmentOzonSku);
        const duplicateLinks = identifiers.length ? await tx.select().from(productLinks).where(or(...identifiers)) : [];
        if (duplicateLinks.some((link) => link.productId !== targetId)) {
          throw new Error("Артикул или SKU Ozon уже связан с другим товаром.");
        }
        const [targetLink] = await tx.select().from(productLinks).where(eq(productLinks.productId, targetId)).limit(1);
        const offerConflict = Boolean(former.reassignmentOfferId && targetLink?.offerId && targetLink.offerId !== former.reassignmentOfferId);
        const skuConflict = Boolean(former.reassignmentOzonSku && targetLink?.ozonSku && targetLink.ozonSku !== former.reassignmentOzonSku);
        if (offerConflict || skuConflict) {
          throw new Error("У выбранного товара уже указаны другие артикул или SKU Ozon.");
        }
        if (hasCompleteOzonLink && targetLink) {
          await tx.update(productLinks).set({
            offerId: targetLink.offerId || former.reassignmentOfferId,
            ozonSku: targetLink.ozonSku || former.reassignmentOzonSku,
          }).where(eq(productLinks.id, targetLink.id));
        } else if (hasCompleteOzonLink) {
          await tx.insert(productLinks).values({
            productId: targetId,
            offerId: former.reassignmentOfferId,
            ozonSku: former.reassignmentOzonSku,
          });
        }
      }

      await tx.update(purchases).set({ productId: targetId }).where(eq(purchases.productId, id));
      await tx.update(purchaseReceiptLines).set({ productId: targetId }).where(eq(purchaseReceiptLines.productId, id));
      await tx.update(supplyLines).set({ productId: targetId }).where(eq(supplyLines.productId, id));
      await tx.update(postingItems).set({ productId: targetId }).where(eq(postingItems.productId, id));
      await tx.update(financeAccruals).set({ productId: targetId }).where(eq(financeAccruals.productId, id));
      await tx.update(returns).set({ productId: targetId, updatedAt: new Date() }).where(eq(returns.productId, id));
      await tx.update(manualWriteoffs).set({ productId: targetId }).where(eq(manualWriteoffs.productId, id));
      await tx.update(ozonWriteoffs).set({ productId: targetId, updatedAt: new Date() }).where(eq(ozonWriteoffs.productId, id));
      await tx.update(stocktakeLines).set({ productId: targetId }).where(eq(stocktakeLines.productId, id));
      await tx.update(stockAdjustments).set({ productId: targetId }).where(eq(stockAdjustments.productId, id));
      await tx.update(externalItems).set({ productId: targetId, disposition }).where(eq(externalItems.productId, id));
      await tx.delete(products).where(eq(products.id, id));
      return { productId: targetId, disposition };
    });

    return Response.json({ success: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
