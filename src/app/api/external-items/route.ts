import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { externalItems, financeAccruals, ozonWriteoffs, postingItems, productLinks, products, returns } from "@/db/schema";
import { financeAccrualRowContainsSku } from "@/ozon/finance";
import { assertLocalMutation, errorResponse, handle, parseBody } from "../_lib/http";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("map"), productId: z.string().uuid() }),
  z.object({ action: z.literal("create"), sku: z.string().trim().min(1).max(100), title: z.string().trim().min(1).max(300), category: z.string().trim().max(120).optional().default("Без категории") }),
  z.object({ action: z.literal("ignore") }),
]);

export async function GET(request: Request) {
  return handle(async () => {
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
      const [item] = await db.update(externalItems).set({ disposition: "ignored", productId: null }).where(eq(externalItems.id, id)).returning();
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
