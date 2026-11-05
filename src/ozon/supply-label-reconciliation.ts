import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { and, eq, isNotNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { supplies, supplyCargoLabels } from "@/db/schema";
import { ozonDownloadLabelFile, ozonInteger, ozonPost } from "@/ozon/client";

type OzonCredentials = { clientId: string; apiKey: string };
type ProgressCounts = { current: number; total: number };
type ProgressReporter = (label: string, counts?: ProgressCounts) => Promise<void>;
type Cargo = { cargo_id?: string | number; type?: string; bundle_id?: string };
type CargoSupply = { supply_id?: string | number; cargoes?: Cargo[] };
type CargoesResponse = { supply?: CargoSupply[]; result?: { supply?: CargoSupply[] } };
type LabelOperationResponse = {
  operation_id?: string | number;
  status?: string;
  result?: { file_url?: string };
  file_url?: string;
  error?: string;
  message?: string;
};

const execFile = promisify(execFileCallback);
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const asString = (value: unknown) => value === undefined || value === null ? "" : String(value);

async function pdfPageToPng(pdf: Buffer) {
  if (pdf.byteLength < 5 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("Ozon вернул файл без PDF-этикетки.");
  }

  const directory = await mkdtemp(path.join(tmpdir(), "ozon-cargo-label-"));
  const inputPath = path.join(directory, "label.pdf");
  const outputBase = path.join(directory, "label");
  const outputPath = `${outputBase}.png`;
  try {
    await writeFile(inputPath, pdf);
    await execFile("pdftoppm", ["-png", "-singlefile", "-r", "203", "-f", "1", "-l", "1", inputPath, outputBase], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    const png = await readFile(outputPath);
    if (png.byteLength < 8 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error("Не удалось подготовить PNG-этикетку.");
    }
    if (png.byteLength > 20 * 1024 * 1024) throw new Error("PNG-этикетка превышает допустимый размер.");
    return png;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function createCargoLabel(credentials: OzonCredentials, supplyId: string, cargoId: string) {
  const created = await ozonPost<LabelOperationResponse>("/v1/cargoes-label/create", {
    supply_id: ozonInteger(supplyId),
    cargoes: [{ cargo_id: ozonInteger(cargoId) }],
  }, credentials);
  const operationId = asString(created.operation_id);
  if (!operationId) throw new Error("Ozon не вернул номер подготовки этикетки.");

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (attempt > 0) await sleep(1_000);
    const response = await ozonPost<LabelOperationResponse>("/v1/cargoes-label/get", { operation_id: operationId }, credentials);
    const status = asString(response.status).toUpperCase();
    if (status === "SUCCESS") {
      const fileUrl = response.result?.file_url ?? response.file_url;
      if (!fileUrl) throw new Error("Ozon не вернул ссылку на этикетку.");
      return pdfPageToPng(await ozonDownloadLabelFile(fileUrl, credentials));
    }
    if (["ERROR", "FAILED", "CANCELLED"].includes(status)) {
      throw new Error("Ozon не смог сформировать этикетку.");
    }
  }
  throw new Error("Ozon ещё не подготовил этикетку. Она появится после следующей синхронизации.");
}

export async function reconcileOzonSupplyLabels(
  credentials: OzonCredentials,
  progress: ProgressReporter = async () => undefined,
) {
  const localSupplies = await db.select({ id: supplies.id, ozonSupplyId: supplies.ozonSupplyId })
    .from(supplies)
    .where(and(eq(supplies.marketplace, "ozon"), isNotNull(supplies.ozonSupplyId)));
  const supplyByOzonId = new Map(localSupplies.flatMap((supply) =>
    supply.ozonSupplyId && /^\d{1,20}$/.test(supply.ozonSupplyId) ? [[supply.ozonSupplyId, supply] as const] : [],
  ));
  const supplyIds = [...supplyByOzonId.keys()];
  if (supplyIds.length === 0) return { suppliesChecked: 0, cargoesFound: 0, labelsSaved: 0, labelsReused: 0, labelsFailed: 0 };

  const cargoes: { supplyId: string; localSupplyId: string; cargoId: string; cargoType: string; bundleId: string }[] = [];
  const batches = Array.from({ length: Math.ceil(supplyIds.length / 100) }, (_, index) => supplyIds.slice(index * 100, index * 100 + 100));
  for (const [index, batch] of batches.entries()) {
    await progress("Получение списка грузомест", { current: index + 1, total: batches.length });
    const response = await ozonPost<CargoesResponse>("/v1/cargoes/get", { supply_ids: batch }, credentials);
    for (const supply of response.supply ?? response.result?.supply ?? []) {
      const ozonSupplyId = asString(supply.supply_id);
      const localSupply = supplyByOzonId.get(ozonSupplyId);
      if (!localSupply) continue;
      const currentCargoes = (supply.cargoes ?? []).flatMap((cargo) => {
        const cargoId = asString(cargo.cargo_id);
        if (!/^\d{1,20}$/.test(cargoId)) return [];
        return [{
          supplyId: ozonSupplyId,
          localSupplyId: localSupply.id,
          cargoId,
          cargoType: asString(cargo.type),
          bundleId: asString(cargo.bundle_id),
        }];
      });
      const uniqueCargoes = [...new Map(currentCargoes.map((cargo) => [cargo.cargoId, cargo])).values()];
      const currentCargoIds = uniqueCargoes.map((cargo) => cargo.cargoId);
      await db.transaction(async (tx) => {
        if (uniqueCargoes.length) {
          await tx.insert(supplyCargoLabels).values(uniqueCargoes.map((cargo) => ({
            supplyId: cargo.localSupplyId,
            ozonSupplyId: cargo.supplyId,
            cargoId: cargo.cargoId,
            cargoType: cargo.cargoType,
            bundleId: cargo.bundleId,
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          }))).onConflictDoUpdate({
            target: [supplyCargoLabels.supplyId, supplyCargoLabels.cargoId],
            set: {
              ozonSupplyId: sql`excluded.ozon_supply_id`,
              cargoType: sql`excluded.cargo_type`,
              bundleId: sql`excluded.bundle_id`,
              lastSeenAt: sql`now()`,
              updatedAt: sql`now()`,
            },
          });
          await tx.delete(supplyCargoLabels).where(and(
            eq(supplyCargoLabels.supplyId, localSupply.id),
            notInArray(supplyCargoLabels.cargoId, currentCargoIds),
          ));
        } else {
          await tx.delete(supplyCargoLabels).where(eq(supplyCargoLabels.supplyId, localSupply.id));
        }
      });
      cargoes.push(...uniqueCargoes);
    }
  }

  let labelsSaved = 0;
  let labelsReused = 0;
  let labelsFailed = 0;
  for (const [index, cargo] of cargoes.entries()) {
    await progress("Сохранение этикеток", { current: index + 1, total: cargoes.length });
    const [label] = await db.select({ id: supplyCargoLabels.id, ready: sql<boolean>`${supplyCargoLabels.labelPng} IS NOT NULL` })
      .from(supplyCargoLabels)
      .where(and(eq(supplyCargoLabels.supplyId, cargo.localSupplyId), eq(supplyCargoLabels.cargoId, cargo.cargoId)))
      .limit(1);

    if (label?.ready) {
      labelsReused += 1;
      continue;
    }

    try {
      const labelPng = await createCargoLabel(credentials, cargo.supplyId, cargo.cargoId);
      await db.update(supplyCargoLabels).set({ labelPng, labelError: "", updatedAt: new Date() }).where(eq(supplyCargoLabels.id, label!.id));
      labelsSaved += 1;
    } catch (error) {
      labelsFailed += 1;
      const detail = error instanceof Error ? error.message.slice(0, 500) : "Не удалось сохранить этикетку.";
      await db.update(supplyCargoLabels).set({ labelError: detail, updatedAt: new Date() }).where(eq(supplyCargoLabels.id, label!.id));
      console.warn("Ozon cargo label was not saved:", { supplyId: cargo.supplyId, cargoId: cargo.cargoId, detail });
    }
  }

  return { suppliesChecked: supplyIds.length, cargoesFound: cargoes.length, labelsSaved, labelsReused, labelsFailed };
}

export async function listSupplyCargoLabels(supplyId: string) {
  const rows = await db.select({
    id: supplyCargoLabels.id,
    cargoId: supplyCargoLabels.cargoId,
    cargoType: supplyCargoLabels.cargoType,
    bundleId: supplyCargoLabels.bundleId,
    ready: sql<boolean>`${supplyCargoLabels.labelPng} IS NOT NULL`,
    needsRetry: sql<boolean>`${supplyCargoLabels.labelError} <> ''`,
  }).from(supplyCargoLabels).where(eq(supplyCargoLabels.supplyId, supplyId));
  return rows.map((row) => ({
    ...row,
    needsRetry: !row.ready && row.needsRetry,
    imageUrl: row.ready ? `/api/supplies/labels/image/${row.id}` : null,
  })).sort((first, second) => first.cargoId.localeCompare(second.cargoId, "en", { numeric: true }));
}

export async function getSupplyCargoLabelImage(labelId: string) {
  const [label] = await db.select({ cargoId: supplyCargoLabels.cargoId, labelPng: supplyCargoLabels.labelPng })
    .from(supplyCargoLabels)
    .where(eq(supplyCargoLabels.id, labelId))
    .limit(1);
  if (!label?.labelPng) return null;
  return { cargoId: label.cargoId, image: label.labelPng };
}
