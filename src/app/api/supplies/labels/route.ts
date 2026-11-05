import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { supplies } from "@/db/schema";
import { listSupplyCargoLabels } from "@/ozon/supply-label-reconciliation";
import { handleLocalGet } from "../../_lib/http";

export async function GET(request: Request) {
  return handleLocalGet(request, async () => {
    const supplyId = z.string().uuid().parse(new URL(request.url).searchParams.get("supplyId"));
    const [supply] = await db.select({ id: supplies.id }).from(supplies).where(eq(supplies.id, supplyId)).limit(1);
    if (!supply) throw new Error("Поставка не найдена.");
    return { items: await listSupplyCargoLabels(supplyId) };
  });
}
