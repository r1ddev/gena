import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { externalItems, financeAccruals, ozonWriteoffs, postingItems, productLinks, products, returns } from "@/db/schema";
import { externalItemIgnorePlan, externalProductKey } from "@/ozon/external-product";
import { financeAccrualRowContainsSku } from "@/ozon/finance";
import { assertLocalMutation, errorResponse, handleLocalGet, parseBody } from "../_lib/http";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("map"), productId: z.string().uuid() }),
  z.object({ action: z.literal("create"), sku: z.string().trim().min(1).max(100), title: z.string().trim().min(1).max(300), category: z.string().trim().max(120).optional().default("Без категории") }),
  z.object({ action: z.literal("ignore") }),
]);

export async function GET(request: Request) {
  return handleLocalGet(request, async () => {
    const disposition = new URL(request.url).searchParams.get("disposition") ?? "pending";
    const items = disposition === "all"
      ? await db.select().from(externalItems).orderBy(desc(externalItems.lastSeenAt))
      : await db.select().from(externalItems).where(eq(externalItems.disposition, "pending")).orderBy(desc(externalItems.lastSeenAt));
    const catalog = await db.select().from(products);
    const byId = new Map(catalog.map((product) => [product.id, product]));
    return { items: items.map((item) => ({ ...item, productTitle: item.productId ? byId.get(item.productId)?.title ?? "" : "" })) };
  });
}

export async function PATCH(request: Request) {
  try {
    assertLocalMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("Не указан идентификатор артикула Ozon.");
    const body = await parseBody(request, actionSchema);
    const external = (await db.select().from(externalItems).where(eq(externalItems.id, id)).limit(1))[0];
    if (!external) throw new Error("Запись не найдена.");
    if (body.action === "ignore") {
      const item = await db.transaction(async (tx) => {
        const sameSkuRows = external.ozonSku
          ? await tx.select({ id: externalItems.id, externalKey: externalItems.externalKey, ozonSku: externalItems.ozonSku, disposition: externalItems.disposition, productId: externalItems.productId })
            .from(externalItems).where(eq(externalItems.ozonSku, external.ozonSku))
          : [{ id: external.id, externalKey: external.externalKey, ozonSku: external.ozonSku, disposition: external.disposition, productId: external.productId }];
        if (external.offerId && external.ozonSku) {
          await tx.delete(productLinks).where(and(eq(productLinks.offerId, external.offerId), eq(productLinks.ozonSku, external.ozonSku)));
        }
        const linkedMappings = external.ozonSku
          ? (await tx.select({ offerId: productLinks.offerId, ozonSku: productLinks.ozonSku, productId: productLinks.productId })
            .from(productLinks).where(eq(productLinks.ozonSku, external.ozonSku)))
            .map((link) => ({ externalKey: externalProductKey(link.offerId, external.ozonSku!), productId: link.productId }))
          : [];
        const plan = externalItemIgnorePlan(sameSkuRows, id, linkedMappings);
        const affectedRows = sameSkuRows.filter((row) => plan.keysToIgnore.includes(row.externalKey));
        const [ignored] = await tx.update(externalItems).set({ disposition: "ignored", productId: null }).where(eq(externalItems.id, id)).returning();
        const siblingIds = affectedRows.filter((row) => row.id !== id && (row.disposition === "pending" || row.disposition === "ignored")).map((row) => row.id);
        if (siblingIds.length) await tx.update(externalItems).set({ disposition: "ignored", productId: null }).where(inArray(externalItems.id, siblingIds));
        if (external.ozonSku) {
          await tx.update(postingItems).set({ productId: null }).where(eq(postingItems.ozonSku, external.ozonSku));
          await tx.update(returns).set({ productId: null, updatedAt: new Date() }).where(eq(returns.ozonSku, external.ozonSku));
          await tx.update(ozonWriteoffs).set({ productId: null, updatedAt: new Date() }).where(eq(ozonWriteoffs.ozonSku, external.ozonSku));
          for (const mapping of plan.mappingsToPreserve) {
            await tx.update(postingItems).set({ productId: mapping.productId }).where(eq(postingItems.externalKey, mapping.externalKey));
            await tx.update(returns).set({ productId: mapping.productId, updatedAt: new Date() }).where(eq(returns.externalKey, mapping.externalKey));
            await tx.update(ozonWriteoffs).set({ productId: mapping.productId, updatedAt: new Date() }).where(eq(ozonWriteoffs.externalKey, mapping.externalKey));
          }
        } else if (plan.keysToIgnore.length) {
          await tx.update(postingItems).set({ productId: null }).where(inArray(postingItems.externalKey, plan.keysToIgnore));
          await tx.update(returns).set({ productId: null, updatedAt: new Date() }).where(inArray(returns.externalKey, plan.keysToIgnore));
          await tx.update(ozonWriteoffs).set({ productId: null, updatedAt: new Date() }).where(inArray(ozonWriteoffs.externalKey, plan.keysToIgnore));
        }
        if (external.ozonSku) {
          const itemAccruals = await tx.select({ id: financeAccruals.id, externalKey: financeAccruals.externalKey, raw: financeAccruals.raw })
            .from(financeAccruals).where(eq(financeAccruals.accruedCategory, "ITEM"));
          const matchingAccrualIds = itemAccruals
            .filter((accrual) => financeAccrualRowContainsSku(accrual.externalKey, accrual.raw, external.ozonSku!))
            .map((accrual) => accrual.id);
          if (matchingAccrualIds.length) await tx.update(financeAccruals).set({ productId: plan.financeProductId }).where(inArray(financeAccruals.id, matchingAccrualIds));
        }
        return ignored;
      });
      return Response.json({ item });
    }

    const item = await db.transaction(async (tx) => {
      let productId = body.action === "map" ? body.productId : "";
      if (body.action === "create") {
        const [created] = await tx.insert(products).values({ sku: body.sku, title: body.title, category: body.category }).returning();
        productId = created.id;
      }
      const [product] = await tx.select().from(products).where(eq(products.id, productId)).limit(1);
      if (!product) throw new Error("Сначала создайте товар в каталоге.");
      if (!external.offerId && !external.ozonSku) throw new Error("У события нет артикула Ozon, по которому можно сохранить сопоставление.");

      const linked = await tx.select().from(productLinks).where(eq(productLinks.offerId, external.offerId));
      const conflict = linked.find((row) => (row.ozonSku ?? "") === external.ozonSku && row.productId !== productId);
      if (conflict) throw new Error("Этот артикул Ozon уже связан с другим товаром.");
      if (!linked.some((row) => (row.ozonSku ?? "") === external.ozonSku && row.productId === productId)) {
        await tx.insert(productLinks).values({ productId, offerId: external.offerId, ozonSku: external.ozonSku || null });
      }

      const disposition = body.action === "create" ? "created" : "mapped";
      const [updated] = await tx.update(externalItems).set({ productId, disposition }).where(eq(externalItems.id, id)).returning();
      await tx.update(postingItems).set({ productId }).where(eq(postingItems.externalKey, external.externalKey));
      await tx.update(returns).set({ productId, updatedAt: new Date() }).where(eq(returns.externalKey, external.externalKey));
      await tx.update(ozonWriteoffs).set({ productId, updatedAt: new Date() }).where(eq(ozonWriteoffs.externalKey, external.externalKey));
      const itemAccruals = await tx.select({ id: financeAccruals.id, externalKey: financeAccruals.externalKey, raw: financeAccruals.raw })
        .from(financeAccruals)
        .where(eq(financeAccruals.accruedCategory, "ITEM"));
      const matchingAccrualIds = itemAccruals
        .filter((accrual) => external.ozonSku && financeAccrualRowContainsSku(accrual.externalKey, accrual.raw, external.ozonSku))
        .map((accrual) => accrual.id);
      if (matchingAccrualIds.length) {
        await tx.update(financeAccruals).set({ productId }).where(inArray(financeAccruals.id, matchingAccrualIds));
      }
      return updated;
    });
    return Response.json({ item });
  } catch (error) { return errorResponse(error); }
}
