import { and, desc, eq, inArray, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { externalItems, financeAccruals, ozonWriteoffs, postingItems, postings, productImages, productLinks, products, returns } from "@/db/schema";
import { externalItemIgnorePlan, externalProductKey } from "@/ozon/external-product";
import { financeAccrualRowContainsSku, financeRowContainsSku } from "@/ozon/finance";
import { readProductImage } from "../_lib/product-image";
import { assertLocalMutation, errorResponse, handleLocalGet, parseBody } from "../_lib/http";

function sourceKind(raw: Record<string, unknown>, hasOrderRow: boolean) {
  const visual = raw.visual && typeof raw.visual === "object" && !Array.isArray(raw.visual) ? raw.visual as Record<string, unknown> : {};
  const status = visual.status && typeof visual.status === "object" && !Array.isArray(visual.status) ? visual.status as Record<string, unknown> : {};
  if (String(status.sys_name ?? "").toLowerCase() === "writeoff") return "writeoff";
  if (Array.isArray(raw.fees) || raw.item_fees) return "finance";
  if ("target_place" in raw || "return_clearing_id" in raw) return "return";
  if ("compensation_price" in raw || "dispose_reason" in raw) return "writeoff";
  if ("digital_codes" in raw) return "buyout";
  if (hasOrderRow || "seller_price_per_instance" in raw || ("offer_id" in raw && "name" in raw && "price" in raw)) return "order";
  if ("is_marketplace_buyout" in raw) return "buyout";
  return "other";
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function uniqueOfferIdsBySku(rows: { offerId: string; ozonSku: string }[]) {
  const candidates = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.offerId || !row.ozonSku) continue;
    const offerIds = candidates.get(row.ozonSku) ?? new Set<string>();
    offerIds.add(row.offerId);
    candidates.set(row.ozonSku, offerIds);
  }
  return new Map([...candidates].flatMap(([sku, offerIds]) => offerIds.size === 1 ? [[sku, [...offerIds][0]] as const] : []));
}

function feeFacts(raw: Record<string, unknown>, sku: string) {
  const rows = Array.isArray(raw.fees)
    ? raw.fees
    : Array.isArray(recordOf(raw.item_fees).fees)
      ? recordOf(raw.item_fees).fees as unknown[]
      : [];
  const matchingRows = rows.flatMap((candidate) => {
    const row = recordOf(candidate);
    if (row.sku !== undefined && String(row.sku) !== sku) return [];
    return Array.isArray(row.fees) ? row.fees : [row];
  });
  const typeAmounts: Record<string, number> = {};
  const amount = matchingRows.reduce((total, candidate) => {
    const fee = recordOf(candidate);
    const accrued = recordOf(fee.accrued);
    const value = Number(accrued.amount ?? fee.accrued ?? 0);
    if (!Number.isFinite(value)) return total;
    const typeId = String(fee.type_id ?? "unknown");
    typeAmounts[typeId] = Math.round(((typeAmounts[typeId] ?? 0) + value) * 100) / 100;
    return total + value;
  }, 0);
  return { amount: Math.round(amount * 100) / 100, typeAmounts };
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("map"), productId: z.string().uuid() }),
  z.object({
    action: z.literal("create"),
    title: z.string().trim().min(1).max(300),
    offerId: z.string().trim().min(1, "Укажите артикул продавца.").max(120),
    ozonSku: z.string().trim().min(1, "Укажите SKU Ozon.").max(40),
  }),
  z.object({ action: z.literal("ignore") }),
  z.object({ action: z.literal("restore") }),
]);

export async function GET(request: Request) {
  return handleLocalGet(request, async () => {
    const disposition = new URL(request.url).searchParams.get("disposition") ?? "pending";
    const items = disposition === "all"
      ? await db.select().from(externalItems).orderBy(desc(externalItems.lastSeenAt))
      : await db.select().from(externalItems)
        .where(eq(externalItems.disposition, disposition === "ignored" ? "ignored" : "pending"))
        .orderBy(desc(externalItems.lastSeenAt));
    const catalog = await db.select().from(products);
    const byId = new Map(catalog.map((product) => [product.id, product]));
    const externalKeys = [...new Set(items.map((item) => item.externalKey))];
    const skus = [...new Set(items.map((item) => item.ozonSku).filter(Boolean))];
    const offerIds = [...new Set(items.flatMap((item) => {
      const rawOfferId = recordOf(item.raw).offer_id;
      const offerId = item.offerId || (typeof rawOfferId === "string" ? rawOfferId : "");
      return offerId ? [offerId] : [];
    }))];
    const productLinkConditions = [
      offerIds.length ? inArray(productLinks.offerId, offerIds) : undefined,
      skus.length ? inArray(productLinks.ozonSku, skus) : undefined,
    ].filter((condition): condition is NonNullable<typeof condition> => condition !== undefined);
    const [orderRows, returnRows, writeoffRows, itemAccruals, knownOrderProducts, knownReturnProducts, knownWriteoffProducts, knownExternalProducts, knownProductLinks] = await Promise.all([
      externalKeys.length
        ? db.select({ externalKey: postingItems.externalKey, postingNumber: postings.externalId })
          .from(postingItems).innerJoin(postings, eq(postingItems.postingId, postings.id)).where(inArray(postingItems.externalKey, externalKeys))
        : Promise.resolve([]),
      externalKeys.length
        ? db.select({ externalKey: returns.externalKey, postingNumber: returns.postingNumber, status: returns.status, destination: returns.destination })
          .from(returns).where(inArray(returns.externalKey, externalKeys))
        : Promise.resolve([]),
      externalKeys.length
        ? db.select({ externalKey: ozonWriteoffs.externalKey, amount: ozonWriteoffs.compensationAmount })
          .from(ozonWriteoffs).where(inArray(ozonWriteoffs.externalKey, externalKeys))
        : Promise.resolve([]),
      skus.length
        ? db.select().from(financeAccruals).where(eq(financeAccruals.accruedCategory, "ITEM"))
        : Promise.resolve([]),
      skus.length
        ? db.select({ offerId: postingItems.offerId, ozonSku: postingItems.ozonSku }).from(postingItems).where(inArray(postingItems.ozonSku, skus))
        : Promise.resolve([]),
      skus.length
        ? db.select({ offerId: returns.offerId, ozonSku: returns.ozonSku }).from(returns).where(inArray(returns.ozonSku, skus))
        : Promise.resolve([]),
      skus.length
        ? db.select({ offerId: ozonWriteoffs.offerId, ozonSku: ozonWriteoffs.ozonSku }).from(ozonWriteoffs).where(inArray(ozonWriteoffs.ozonSku, skus))
        : Promise.resolve([]),
      skus.length
        ? db.select({ offerId: externalItems.offerId, ozonSku: externalItems.ozonSku }).from(externalItems).where(inArray(externalItems.ozonSku, skus))
        : Promise.resolve([]),
      productLinkConditions.length
        ? db.select({ offerId: productLinks.offerId, ozonSku: productLinks.ozonSku }).from(productLinks)
          .innerJoin(products, and(eq(products.id, productLinks.productId), eq(products.reassignmentPending, false)))
          .where(or(...productLinkConditions))
        : Promise.resolve([]),
    ]);
    const visibleItems = disposition === "pending" ? items.filter((item) => {
      const rawOfferId = recordOf(item.raw).offer_id;
      const offerId = item.offerId || (typeof rawOfferId === "string" ? rawOfferId : "");
      return !knownProductLinks.some((link) => {
        if (item.ozonSku) return link.ozonSku === item.ozonSku;
        return Boolean(offerId && link.offerId === offerId);
      });
    }) : items;
    const visibleExternalKeys = [...new Set(visibleItems.map((item) => item.externalKey))];
    const offerIdBySku = uniqueOfferIdsBySku([
      ...knownOrderProducts,
      ...knownReturnProducts,
      ...knownWriteoffProducts,
      ...knownExternalProducts,
      ...knownProductLinks,
    ]);
    const orderNumbersByKey = new Map<string, string[]>();
    for (const row of orderRows.filter((item) => visibleExternalKeys.includes(item.externalKey))) orderNumbersByKey.set(row.externalKey, [...(orderNumbersByKey.get(row.externalKey) ?? []), row.postingNumber]);
    const returnsByKey = new Map(returnRows.map((row) => [row.externalKey, row]));
    const writeoffsByKey = new Map(writeoffRows.map((row) => [row.externalKey, row]));
    const sourceCounts: Record<string, number> = {};
    const enriched = visibleItems.map((item) => {
      const raw = item.raw as Record<string, unknown>;
      const orderNumbers = orderNumbersByKey.get(item.externalKey) ?? [];
      const kind = sourceKind(raw, orderNumbers.length > 0);
      sourceCounts[kind] = (sourceCounts[kind] ?? 0) + 1;
      const returnRow = returnsByKey.get(item.externalKey);
      const writeoffRow = writeoffsByKey.get(item.externalKey);
      const matchingAccruals = kind === "finance"
        ? itemAccruals.filter((row) => financeAccrualRowContainsSku(row.externalKey, row.raw, item.ozonSku))
        : [];
      const candidateAccruals = matchingAccruals.filter((row) => {
        const facts = feeFacts(raw, item.ozonSku);
        const expectedAmount = facts.typeAmounts[row.typeId];
        return expectedAmount === undefined || Math.round(Number(row.amount) * 100) === Math.round(expectedAmount * 100);
      }).sort((left, right) => right.accrualDate.localeCompare(left.accrualDate));
      const ref = (value: unknown) => typeof value === "string" && value ? value : "";
      let details: Record<string, unknown> = { kind, orderNumbers };
      if (kind === "finance") {
        const facts = feeFacts(raw, item.ozonSku);
        const accrualNumber = ref(raw.unit_number)
          || ref(candidateAccruals.find((row) => ref(row.raw.unit_number))?.raw.unit_number)
          || candidateAccruals.find((row) => row.postingNumber)?.postingNumber
          || "";
        const accrualDate = ref(raw.accrual_date) || candidateAccruals[0]?.accrualDate || "";
        details = { ...details, amount: facts.amount, accrualNumber, accrualDate, typeId: ref(raw.type_id) || candidateAccruals[0]?.typeId || "" };
      } else if (kind === "return") {
        details = { ...details, postingNumber: ref(raw.posting_number) || returnRow?.postingNumber || "", status: returnRow?.status ?? "", destination: returnRow?.destination ?? "" };
      } else if (kind === "writeoff") {
        details = { ...details, postingNumber: ref(raw.posting_number), amount: writeoffRow?.amount ?? raw.compensation_price ?? null, date: raw.date ?? null };
      } else if (kind === "buyout") {
        details = { ...details, postingNumber: ref(raw.posting_number), amount: raw.amount ?? raw.buyout_price ?? null };
      } else if (kind === "order") {
        details = { ...details, postingNumber: orderNumbers[0] ?? ref(raw.posting_number), quantity: raw.quantity ?? null, amount: raw.price ?? raw.seller_price_per_instance ?? null };
      }
      const rawOfferId = typeof raw.offer_id === "string" ? raw.offer_id : "";
      return {
        ...item,
        offerId: item.offerId || rawOfferId || offerIdBySku.get(item.ozonSku) || "",
        productTitle: item.productId ? byId.get(item.productId)?.title ?? "" : "",
        sourceInfo: details,
      };
    });
    return { items: enriched, sourceCounts };
  });
}

export async function PATCH(request: Request) {
  try {
    assertLocalMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("Не указан идентификатор артикула Ozon.");
    let rawBody: unknown;
    let image: Awaited<ReturnType<typeof readProductImage>> = null;
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const formData = await request.formData();
      rawBody = { action: formData.get("action"), title: formData.get("title"), offerId: formData.get("offerId"), ozonSku: formData.get("ozonSku") };
      image = await readProductImage(formData);
    } else {
      rawBody = await parseBody(request, actionSchema);
    }
    const body = actionSchema.parse(rawBody);
    if (image && body.action !== "create") throw new Error("Изображение можно добавить только при создании товара.");
    const external = (await db.select().from(externalItems).where(eq(externalItems.id, id)).limit(1))[0];
    if (!external) throw new Error("Запись не найдена.");
    if (body.action === "restore") {
      const ignoredRows = await db.update(externalItems)
        .set({ disposition: "pending", productId: null })
        .where(and(
          eq(externalItems.disposition, "ignored"),
          external.ozonSku ? eq(externalItems.ozonSku, external.ozonSku) : eq(externalItems.id, external.id),
        ))
        .returning();
      return Response.json({ items: ignoredRows });
    }
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
      const offerId = body.action === "create" ? body.offerId || external.offerId : external.offerId;
      const ozonSku = body.action === "create" ? body.ozonSku || external.ozonSku : external.ozonSku;
      if (!offerId && !ozonSku) throw new Error("В записи Ozon не указаны артикул и SKU.");
      if (body.action === "create" && (!offerId || !ozonSku)) throw new Error("Для товара нужны артикул продавца и SKU Ozon.");

      if (body.action === "create") {
        const [created] = await tx.insert(products).values({ sku: offerId || ozonSku, title: body.title }).returning();
        productId = created.id;
        if (image) await tx.insert(productImages).values({ productId, ...image });
      }
      const [product] = await tx.select().from(products).where(eq(products.id, productId)).limit(1);
      if (!product) throw new Error("Сначала создайте товар в каталоге.");

      const identifiers = [
        offerId ? eq(productLinks.offerId, offerId) : undefined,
        ozonSku ? eq(productLinks.ozonSku, ozonSku) : undefined,
      ].filter((condition): condition is NonNullable<typeof condition> => condition !== undefined);
      const matchingLinks = identifiers.length
        ? await tx.select().from(productLinks).where(or(...identifiers))
        : [];
      if (matchingLinks.some((link) => link.productId !== productId)) {
        throw new Error("Этот артикул или SKU Ozon уже указан у другого товара.");
      }
      const [currentProductIdentifiers] = await tx.select().from(productLinks).where(eq(productLinks.productId, productId)).limit(1);
      const offerIdConflict = Boolean(offerId && currentProductIdentifiers?.offerId && currentProductIdentifiers.offerId !== offerId);
      const ozonSkuConflict = Boolean(ozonSku && currentProductIdentifiers?.ozonSku && currentProductIdentifiers.ozonSku !== ozonSku);
      if (currentProductIdentifiers && (offerIdConflict || ozonSkuConflict)) {
        throw new Error("У товара уже указаны другие артикул и SKU Ozon. Измените их в каталоге и повторите сопоставление.");
      }
      if (currentProductIdentifiers && (currentProductIdentifiers.offerId !== offerId || (currentProductIdentifiers.ozonSku ?? "") !== ozonSku)) {
        await tx.update(productLinks).set({
          offerId: currentProductIdentifiers.offerId || offerId,
          ozonSku: currentProductIdentifiers.ozonSku || ozonSku,
        }).where(eq(productLinks.id, currentProductIdentifiers.id));
      } else if (!currentProductIdentifiers) {
        if (!offerId || !ozonSku) throw new Error("Для товара нужны артикул продавца и SKU Ozon. Укажите их в каталоге и повторите сопоставление.");
        await tx.insert(productLinks).values({ productId, offerId, ozonSku });
      }

      const disposition = body.action === "create" ? "created" : "mapped";
      const siblingRows = ozonSku
        ? await tx.select({ id: externalItems.id, externalKey: externalItems.externalKey }).from(externalItems)
          .where(and(eq(externalItems.ozonSku, ozonSku), ne(externalItems.disposition, "ignored")))
        : [];
      const relatedExternalIds = [...new Set([external.id, ...siblingRows.map((row) => row.id)])];
      const relatedExternalKeys = [...new Set([external.externalKey, ...siblingRows.map((row) => row.externalKey)])];
      const [updated] = await tx.update(externalItems).set({ productId, disposition }).where(inArray(externalItems.id, relatedExternalIds)).returning();
      const orderCondition = ozonSku
        ? or(eq(postingItems.ozonSku, ozonSku), inArray(postingItems.externalKey, relatedExternalKeys))
        : inArray(postingItems.externalKey, relatedExternalKeys);
      const returnCondition = ozonSku
        ? or(eq(returns.ozonSku, ozonSku), inArray(returns.externalKey, relatedExternalKeys))
        : inArray(returns.externalKey, relatedExternalKeys);
      const writeoffCondition = ozonSku
        ? or(eq(ozonWriteoffs.ozonSku, ozonSku), inArray(ozonWriteoffs.externalKey, relatedExternalKeys))
        : inArray(ozonWriteoffs.externalKey, relatedExternalKeys);
      await tx.update(postingItems).set({ productId }).where(orderCondition);
      await tx.update(returns).set({ productId, updatedAt: new Date() }).where(returnCondition);
      await tx.update(ozonWriteoffs).set({ productId, updatedAt: new Date() }).where(writeoffCondition);
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
