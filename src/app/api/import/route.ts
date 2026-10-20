import { createHash } from "node:crypto";
import { db } from "@/db";
import { importBatches, importRows } from "@/db/schema";
import { parseImportBuffer } from "@/importer/workbook";
import { maximumImportFileBytes, maximumImportRequestBytes, maximumImportRows, readRequestBodyWithinLimit } from "@/importer/file-limits";
import { assertLocalMutation, errorResponse } from "../_lib/http";

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const requestBody = await readRequestBodyWithinLimit(request, maximumImportRequestBytes);
    const boundedRequest = new Request(request.url, { method: "POST", headers: request.headers, body: requestBody });
    const form = await boundedRequest.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Выберите файл .xlsx или .csv.");
    if (file.size === 0) throw new Error("Файл пустой.");
    if (file.size > maximumImportFileBytes) throw new Error("Размер файла не должен превышать 20 МБ.");
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const contentHash = createHash("sha256").update(fileBuffer).digest("hex");
    const parsed = await parseImportBuffer(fileBuffer, file.name);
    if (parsed.rows.length > maximumImportRows) throw new Error("В файле слишком много строк для одного переноса: максимум 30 000.");
    const fileName = file.name.split(/[\\/]/).pop()?.slice(0, 240) || "import.xlsx";
    const counts = parsed.rows.reduce<Record<string, number>>((result, row) => ({ ...result, [row.type]: (result[row.type] ?? 0) + 1 }), {});
    const summary = {
      sheets: parsed.sheets,
      totalRows: parsed.rows.length,
      byType: counts,
      unrecognizedRows: counts.unknown ?? 0,
      note: "Неопознанные строки сохраняются в отчёте пакета и не изменяют учёт.",
    };
    const batchId = await db.transaction(async (tx) => {
      const [batch] = await tx.insert(importBatches).values({ fileName, contentHash, summary }).returning({ id: importBatches.id });
      for (let offset = 0; offset < parsed.rows.length; offset += 300) {
        const chunk = parsed.rows.slice(offset, offset + 300);
        await tx.insert(importRows).values(chunk.map((row) => ({
          batchId: batch.id,
          sheetName: row.sheetName,
          rowNumber: row.rowNumber,
          rowType: row.type,
          data: row.data,
          issue: row.type === "unknown" ? "Тип данных не распознан; строка не будет перенесена." : null,
        })));
      }
      return batch.id;
    });
    return Response.json({ batchId, summary, rows: parsed.rows.slice(0, 100).map((row) => ({ ...row, id: `${row.sheetName}:${row.rowNumber}` })) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
