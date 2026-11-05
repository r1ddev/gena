import { desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { productLinks, products, supplies, supplyCargoLabels, supplyLines } from "@/db/schema";
import { getAccountingSnapshot } from "@/domain/accounting-repository";
import { reconcileOzonSupplyCosts } from "@/ozon/supply-cost-reconciliation";
import { assertLocalMutation, errorResponse, handleLocalGet, parseBody } from "../_lib/http";
import { isoDate, positiveInteger } from "../_lib/validation";

const supplySchema = z.object({
  suppliedAt: isoDate,
  marketplace: z.enum(["ozon", "wb", "avito", "other", "unknown"]).optional(),
  note: z.string().trim().max(2000).optional().default(""),
  lines: z.array(z.object({
    productId: z.string().uuid(),
    quantity: positiveInteger,
  })).min(1),
});

function assertUniqueProductLines(lines: { productId: string }[]) {
  if (new Set(lines.map((line) => line.productId)).size !== lines.length) {
    throw new Error("В одной поставке товар должен быть указан одной строкой.");
  }
}

export async function GET(request: Request) {
  return handleLocalGet(request, async () => {
    const [headers, lines, catalog, cargoLabels] = await Promise.all([
      db.select().from(supplies).orderBy(desc(supplies.suppliedAt), desc(supplies.createdAt)),
      db.select().from(supplyLines),
      db.select().from(products),
      db.select({ supplyId: supplyCargoLabels.supplyId, ready: sql<boolean>`${supplyCargoLabels.labelPng} IS NOT NULL` }).from(supplyCargoLabels),
    ]);
    const activeProductIds = new Set(catalog.filter((product) => !product.archived).map((product) => product.id));
    const visibleLines = lines.filter((line) => activeProductIds.has(line.productId));
    const productById = new Map(catalog.map((product) => [product.id, product]));
    const labelCounts = new Map<string, { total: number; ready: number }>();
    for (const label of cargoLabels) {
      const count = labelCounts.get(label.supplyId) ?? { total: 0, ready: 0 };
      count.total += 1;
      if (label.ready) count.ready += 1;
      labelCounts.set(label.supplyId, count);
    }
    const marketplaceLabels: Record<string, string> = { ozon: "Ozon", wb: "WB", avito: "Авито", other: "Другая площадка", unknown: "Не указана" };
    return { items: headers.flatMap((supply) => {
      const matching = visibleLines.filter((line) => line.supplyId === supply.id);
      if (matching.length === 0) return [];
      return {
        ...supply,
        cargoLabelCount: labelCounts.get(supply.id)?.total ?? 0,
        readyCargoLabelCount: labelCounts.get(supply.id)?.ready ?? 0,
        marketplaceLabel: marketplaceLabels[supply.marketplace] ?? marketplaceLabels.unknown,
        lines: matching.map((line) => ({
          ...line,
          sku: productById.get(line.productId)?.sku ?? line.productSkuSnapshot,
          title: productById.get(line.productId)?.title ?? line.productTitleSnapshot,
        })),
        articles: matching.map((line) => {
          const article = productById.get(line.productId)?.sku || line.productSkuSnapshot || "Артикул не указан";
          const quantity = Number(line.quantity).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
          return `${article} × ${quantity}`;
        }).join(", "),
        quantity: matching.reduce((sum, line) => sum + Number(line.quantity), 0),
      };
    }) };
  });
}

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const body = await parseBody(request, supplySchema);
    assertUniqueProductLines(body.lines);
    const currentUnitCosts = await loadCurrentUnitCosts();
    const item = await db.transaction(async (tx) => {
      const productsById = await loadProductSnapshots(tx, body.lines);
      const [header] = await tx.insert(supplies).values({
        suppliedAt: body.suppliedAt,
        shippingCost: "0",
        marketplace: body.marketplace ?? "ozon",
        note: body.note,
      }).returning();
      await tx.insert(supplyLines).values(body.lines.map((line) => ({
        supplyId: header.id,
        ...line,
        ...productsById.get(line.productId)!,
        ...currentUnitCosts.get(line.productId),
      })));
      return header;
    });
    await reconcileOzonSupplyCosts();
    const [refreshed] = await db.select().from(supplies).where(eq(supplies.id, item.id));
    return Response.json({ item: refreshed ?? item }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    assertLocalMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("Не указан идентификатор поставки.");
    const supplyId = z.string().uuid().parse(id);
    const body = await parseBody(request, supplySchema);
    assertUniqueProductLines(body.lines);
    const currentUnitCosts = await loadCurrentUnitCosts();
    const item = await db.transaction(async (tx) => {
      const productsById = await loadProductSnapshots(tx, body.lines);
      const [previous] = await tx.select().from(supplies).where(eq(supplies.id, supplyId));
      if (!previous) throw new Error("Поставка не найдена.");
      const previousLines = await tx.select().from(supplyLines).where(eq(supplyLines.supplyId, supplyId));
      const previousCosts = new Map(previousLines.map((line) => [line.productId, {
        purchaseUnitCostSnapshot: line.purchaseUnitCostSnapshot,
        landedUnitCostSnapshot: line.landedUnitCostSnapshot,
      }]));
      const [updated] = await tx.update(supplies).set({
        suppliedAt: body.suppliedAt,
        marketplace: body.marketplace ?? previous.marketplace,
        shippingCost: (body.marketplace ?? previous.marketplace) === "ozon" ? previous.shippingCost : "0",
        ozonSupplyId: (body.marketplace ?? previous.marketplace) === "ozon" ? previous.ozonSupplyId : null,
        note: body.note,
      }).where(eq(supplies.id, supplyId)).returning();
      await tx.delete(supplyLines).where(eq(supplyLines.supplyId, supplyId));
      await tx.insert(supplyLines).values(body.lines.map((line) => ({
        supplyId,
        ...line,
        ...productsById.get(line.productId)!,
        ...(previousCosts.get(line.productId) ?? currentUnitCosts.get(line.productId)),
      })));
      return updated;
    });
    await reconcileOzonSupplyCosts();
    const [refreshed] = await db.select().from(supplies).where(eq(supplies.id, item.id));
    return Response.json({ item: refreshed ?? item });
  } catch (error) { return errorResponse(error); }
}

async function loadCurrentUnitCosts() {
  const accounting = await getAccountingSnapshot();
  return new Map(accounting.products.map((product) => [product.productId, {
    purchaseUnitCostSnapshot: product.averagePurchaseCost,
    landedUnitCostSnapshot: product.landedUnitCost,
  }]));
}

async function loadProductSnapshots(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], lines: { productId: string }[]) {
  const productIds = lines.map((line) => line.productId);
  const rows = await tx.select({ id: products.id, sku: products.sku, title: products.title, offerId: productLinks.offerId, archived: products.archived })
    .from(products).leftJoin(productLinks, eq(productLinks.productId, products.id)).where(inArray(products.id, productIds));
  if (rows.length !== productIds.length || rows.some((product) => product.archived)) {
    throw new Error("Выберите товары из текущего каталога.");
  }
  return new Map(rows.map((product) => [product.id, {
    productSkuSnapshot: product.offerId || product.sku,
    productTitleSnapshot: product.title,
  }]));
}

export async function DELETE(request: Request) {
  try {
    assertLocalMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("Не указан идентификатор поставки.");
    const [deleted] = await db.delete(supplies).where(eq(supplies.id, id)).returning({ id: supplies.id });
    if (!deleted) throw new Error("Запись не найдена.");
    return Response.json({ deleted: deleted.id });
  } catch (error) { return errorResponse(error); }
}
