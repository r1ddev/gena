import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { calculateScenario, type ScenarioParameters } from "@/domain/scenario";
import { db } from "@/db";
import { scenarioCalculations } from "@/db/schema";
import { errorResponse, handleLocalGet, parseBody, requireAuthenticatedMutation } from "../_lib/http";

const parametersSchema = z.object({
  purchase: z.number().finite(),
  sale: z.number().finite(),
  outboundDelivery: z.number().finite(),
  returnDelivery: z.number().finite(),
  acquiring: z.number().finite(),
  commission: z.number().finite(),
  promotion: z.number().finite(),
  successRate: z.number().finite(),
  additionalCost: z.number().finite(),
});

const calculationSchema = z.object({
  comment: z.string().trim().min(1, "Добавь комментарий к расчёту.").max(2000),
  inputs: parametersSchema,
});

function valuesForSave(comment: string, inputs: ScenarioParameters) {
  const result = calculateScenario(inputs);
  if (!result) throw new Error("Для сохранения укажи цену продажи больше нуля и процент успешных продаж от 0 до 100.");
  return {
    comment,
    inputs,
    profit: result.profit.toFixed(2),
    profitShare: result.profitShare.toFixed(4),
    updatedAt: new Date(),
  };
}

export async function GET(request: Request) {
  return handleLocalGet(request, async (userId) => ({
    items: await db.select().from(scenarioCalculations).where(eq(scenarioCalculations.userId, userId)).orderBy(desc(scenarioCalculations.createdAt)),
  }));
}

export async function POST(request: Request) {
  try {
    const userId = await requireAuthenticatedMutation(request);
    const body = await parseBody(request, calculationSchema);
    const [item] = await db.insert(scenarioCalculations).values({ userId, ...valuesForSave(body.comment, body.inputs) }).returning();
    return Response.json({ item }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireAuthenticatedMutation(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id || !z.string().uuid().safeParse(id).success) throw new Error("Не указан корректный идентификатор расчёта.");
    const body = await parseBody(request, calculationSchema);
    const [item] = await db.update(scenarioCalculations)
      .set(valuesForSave(body.comment, body.inputs))
      .where(and(eq(scenarioCalculations.id, id), eq(scenarioCalculations.userId, userId)))
      .returning();
    if (!item) throw new Error("Сохранённый расчёт не найден.");
    return Response.json({ item });
  } catch (error) { return errorResponse(error); }
}
