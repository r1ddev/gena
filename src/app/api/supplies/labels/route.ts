import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appSettings, supplies } from "@/db/schema";
import { ozonDownloadLabelFile, ozonInteger, ozonPost, OzonApiError } from "@/ozon/client";
import { decryptSecret } from "@/security/secrets";
import { assertLocalMutation, errorResponse, parseBody } from "../../_lib/http";

const labelRequestSchema = z.object({
  supplyId: z.string().uuid(),
  operationId: z.string().trim().min(1).max(200).optional(),
});

type OzonLabelPayload = {
  operation_id?: string | number;
  status?: string;
  file_guid?: string;
  file_url?: string;
  error?: string;
  message?: string;
};

function payloadOf(value: unknown): OzonLabelPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const nested = record.result ?? record.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested as OzonLabelPayload;
  return record as OzonLabelPayload;
}

function friendlyOzonError(error: unknown) {
  if (error instanceof OzonApiError && error.status === 429) {
    return new Error("Ozon временно ограничил запрос. Подождите несколько секунд и попробуйте снова.");
  }
  console.error("Could not get Ozon cargo labels:", error);
  return new Error("Не удалось получить этикетки из Ozon. Проверьте, что грузоместа созданы, и попробуйте снова.");
}

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const body = await parseBody(request, labelRequestSchema);
    const [supply] = await db.select().from(supplies).where(eq(supplies.id, body.supplyId)).limit(1);
    if (!supply) throw new Error("Поставка не найдена.");
    if (supply.marketplace !== "ozon") throw new Error("Этикетки доступны только для поставок Ozon.");
    if (!supply.ozonSupplyId) throw new Error("У поставки ещё нет ID Ozon. Сначала свяжите её с заявкой.");
    if (!/^\d{1,20}$/.test(supply.ozonSupplyId)) throw new Error("В поставке указан некорректный ID Ozon.");

    const [settings] = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
    if (!settings?.ozonClientId || !settings.ozonApiKeyEncrypted) throw new Error("Сначала подключите Ozon API в настройках.");
    const credentials = { clientId: settings.ozonClientId, apiKey: decryptSecret(settings.ozonApiKeyEncrypted) };

    let operationId = body.operationId;
    if (!operationId) {
      try {
        const created = payloadOf(await ozonPost<unknown>("/v1/cargoes-label/create", {
          supply_id: ozonInteger(supply.ozonSupplyId),
        }, credentials, { maxAttempts: 1, timeoutMs: 15_000 }));
        operationId = created.operation_id == null ? undefined : String(created.operation_id);
      } catch (error) {
        throw friendlyOzonError(error);
      }
      if (!operationId) throw new Error("Ozon не вернул номер подготовки этикеток. Попробуйте ещё раз.");
    }

    let labelStatus: OzonLabelPayload;
    try {
      labelStatus = payloadOf(await ozonPost<unknown>("/v1/cargoes-label/get", { operation_id: operationId }, credentials, { maxAttempts: 1, timeoutMs: 15_000 }));
    } catch (error) {
      if (!(error instanceof OzonApiError) || error.status === 429 || (error.status ?? 0) >= 500) {
        return Response.json({ status: "pending", operationId }, { status: 202, headers: { "Cache-Control": "no-store" } });
      }
      throw friendlyOzonError(error);
    }

    const status = labelStatus.status?.toUpperCase() ?? "";
    if (status !== "SUCCESS") {
      if (["ERROR", "FAILED", "CANCELLED"].includes(status)) {
        console.error("Ozon label generation failed:", { supplyId: supply.id, status, detail: labelStatus.error ?? labelStatus.message });
        throw new Error("Ozon не смог сформировать этикетки. Проверьте грузоместа в личном кабинете и попробуйте снова.");
      }
      if (["NEW", "PENDING", "IN_PROGRESS", "PROCESSING", "RUNNING"].includes(status)) {
        return Response.json({ status: "pending", operationId }, { status: 202, headers: { "Cache-Control": "no-store" } });
      }
      throw new Error("Ozon вернул неизвестный статус подготовки этикеток. Повторите запрос позже.");
    }

    try {
      const fileGuid = typeof labelStatus.file_guid === "string" ? labelStatus.file_guid : null;
      const fileUrl = typeof labelStatus.file_url === "string" ? labelStatus.file_url : null;
      const file = await ozonDownloadLabelFile(fileGuid, fileUrl, credentials);
      if (file.byteLength < 5 || file.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new OzonApiError("Ozon returned a label file that is not a PDF.");
      }
      return new Response(new Uint8Array(file), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="ozon-labels-${supply.ozonSupplyId}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      throw friendlyOzonError(error);
    }
  } catch (error) {
    return errorResponse(error);
  }
}
