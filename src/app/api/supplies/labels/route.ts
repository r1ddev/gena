import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { supplies, supplyCargoLabels } from "@/db/schema";
import { handleLocalGet } from "../../_lib/http";

export async function GET(request: Request) {
  return handleLocalGet(request, async (userId) => {
    const supplyId = z.string().uuid().parse(new URL(request.url).searchParams.get("supplyId"));
    const [supply] = await db.select({ id: supplies.id }).from(supplies)
      .where(and(eq(supplies.id, supplyId), eq(supplies.userId, userId))).limit(1);
    if (!supply) throw new Error("Поставка не найдена.");
    const labels = await db.select({
      id: supplyCargoLabels.id,
      cargoId: supplyCargoLabels.cargoId,
      cargoType: supplyCargoLabels.cargoType,
      bundleId: supplyCargoLabels.bundleId,
      ready: sql<boolean>`${supplyCargoLabels.labelPng} IS NOT NULL`,
      needsRetry: sql<boolean>`${supplyCargoLabels.labelError} <> ''`,
    }).from(supplyCargoLabels).where(and(eq(supplyCargoLabels.supplyId, supplyId), eq(supplyCargoLabels.userId, userId)));
    return { items: labels.map((label) => ({
      ...label,
      needsRetry: !label.ready && label.needsRetry,
      imageUrl: label.ready ? `/api/supplies/labels/image/${label.id}` : null,
    })).sort((first, second) => first.cargoId.localeCompare(second.cargoId, "en", { numeric: true })) };
  });
}
