import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { encryptSecret } from "@/security/secrets";
import { DEFAULT_ACCOUNTING_START_DATE, isValidHistoryStartDate } from "@/ozon/sync-range";
import { errorResponse, handleLocalGet, parseBody, requireAuthenticatedMutation } from "../_lib/http";

const settingsSchema = z.object({
  clientId: z.string().trim().min(1).max(100),
  apiKey: z.string().trim().max(500).optional().default(""),
  accountingStartDate: z.string().refine((value) => isValidHistoryStartDate(value), "Укажи существующую дату не позже сегодняшней."),
  syncIntervalHours: z.number().int().min(1).max(168).optional().default(24),
});

export async function GET(request: Request) {
  return handleLocalGet(request, async (userId) => {
    const [settings] = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
    return {
      configured: Boolean(settings?.ozonClientId && settings?.ozonApiKeyEncrypted),
      clientId: settings?.ozonClientId ?? "",
      hasApiKey: Boolean(settings?.ozonApiKeyEncrypted),
      accountingStartDate: settings?.accountingStartDate ?? DEFAULT_ACCOUNTING_START_DATE,
      syncIntervalHours: settings?.syncIntervalHours ?? 24,
      lastSyncAt: settings?.lastSyncAt?.toISOString() ?? null,
      updatedAt: settings?.updatedAt?.toISOString() ?? null,
    };
  });
}

export async function POST(request: Request) {
  try {
    const userId = await requireAuthenticatedMutation(request);
    const body = await parseBody(request, settingsSchema);
    const [existing] = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
    if (!body.apiKey && !existing?.ozonApiKeyEncrypted) throw new Error("Укажите API-ключ Ozon.");
    const values = {
      ozonClientId: body.clientId,
      ...(body.apiKey ? { ozonApiKeyEncrypted: encryptSecret(body.apiKey) } : {}),
      accountingStartDate: body.accountingStartDate,
      syncIntervalHours: body.syncIntervalHours,
      updatedAt: new Date(),
    };
    if (existing) {
      await db.update(appSettings).set(values).where(eq(appSettings.userId, userId));
    } else {
      await db.insert(appSettings).values({ ...values, userId });
    }
    return Response.json({
      saved: true,
      clientId: body.clientId,
      hasApiKey: true,
      accountingStartDate: body.accountingStartDate,
      syncIntervalHours: body.syncIntervalHours,
    });
  } catch (error) { return errorResponse(error); }
}
