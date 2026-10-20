import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { encryptSecret } from "@/security/secrets";
import { assertLocalMutation, errorResponse, handle, parseBody } from "../_lib/http";

const settingsSchema = z.object({
  clientId: z.string().trim().min(1).max(100),
  apiKey: z.string().trim().max(500).optional().default(""),
  syncIntervalHours: z.number().int().min(1).max(168).optional().default(24),
});

export async function GET() {
  return handle(async () => {
    const [settings] = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
    return {
      configured: Boolean(settings?.ozonClientId && settings?.ozonApiKeyEncrypted),
      clientId: settings?.ozonClientId ?? "",
      hasApiKey: Boolean(settings?.ozonApiKeyEncrypted),
      syncIntervalHours: settings?.syncIntervalHours ?? 24,
      lastSyncAt: settings?.lastSyncAt?.toISOString() ?? null,
      updatedAt: settings?.updatedAt?.toISOString() ?? null,
    };
  });
}

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const body = await parseBody(request, settingsSchema);
    const [existing] = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
    if (!body.apiKey && !existing?.ozonApiKeyEncrypted) throw new Error("Укажите API-ключ Ozon.");
    const values = {
      id: 1,
      ozonClientId: body.clientId,
      ...(body.apiKey ? { ozonApiKeyEncrypted: encryptSecret(body.apiKey) } : {}),
      syncIntervalHours: body.syncIntervalHours,
      updatedAt: new Date(),
    };
    await db.insert(appSettings).values(values).onConflictDoUpdate({
      target: appSettings.id,
      set: {
        ozonClientId: values.ozonClientId,
        ...(values.ozonApiKeyEncrypted ? { ozonApiKeyEncrypted: values.ozonApiKeyEncrypted } : {}),
        syncIntervalHours: values.syncIntervalHours,
        updatedAt: values.updatedAt,
      },
    });
    return Response.json({
      saved: true,
      clientId: body.clientId,
      hasApiKey: true,
      syncIntervalHours: body.syncIntervalHours,
    });
  } catch (error) { return errorResponse(error); }
}
