import { and, eq, like, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { expenses, financeAccruals, importBatches, importRows, manualWriteoffs, postingItems, postings, productLinks, products, purchaseReceipts, purchases, returns, stocktakeLines, stocktakes, supplies, supplyLines } from "@/db/schema";
import { makeImportSourceKey } from "@/importer/source-key";
import { findPreviouslyAppliedBatch } from "@/importer/content-guard";
import { getImportCellValue, getSupplyShippingCost, normalizeImportHeader, parseImportDate, parseImportMoney } from "@/importer/workbook";
import { assertLocalMutation, errorResponse, parseBody } from "../../_lib/http";

const requestSchema = z.object({ batchId: z.string().uuid() });
type StoredRow = { headers: string[]; cells: Record<string, unknown>; values?: unknown[] };
type SaleSource = { row: typeof importRows.$inferSelect; data: StoredRow; orderId: string; productSku: string; status: string; quantity: number; amount: number | null; orderDate: string | null; deliveredAt: string | null };

function cell(data: StoredRow, aliases: string[]) {
  return getImportCellValue(data.cells, aliases);
}

function valueAt(data: StoredRow, index: number) { return data.values?.[index] ?? null; }
function text(value: unknown) { return value === null || value === undefined ? "" : String(value).trim(); }
function sourceKey(row: typeof importRows.$inferSelect, contentHash: string, suffix = "") {
  return makeImportSourceKey(contentHash, `row:${row.sheetName}:${row.rowNumber}${suffix ? `:${suffix}` : ""}`);
}
function yes(value: unknown) { return /^(да|yes|true|1|получен|выполнен|выполнена|доставлен|received)$/i.test(text(value)); }
function isDelivered(value: string) { return /доставлен|delivered|выкуп/i.test(value); }
function dateValue(data: StoredRow, aliases: string[]) { return parseImportDate(cell(data, aliases)); }
function quantityValue(value: unknown, fallback = 0) { return parseImportMoney(value) ?? fallback; }
function productSku(data: StoredRow) { return text(cell(data, ["sku", "артикул", "карточка", "карточка (артикул)", "код товара", "offer id"])); }
function amountValue(data: StoredRow, aliases: string[]) { return parseImportMoney(cell(data, aliases)); }
function statusValue(value: unknown) { return text(value) || "unknown"; }

function returnDestination(value: unknown): "seller" | "ozon" | "unknown" {
  const normalized = text(value).toLowerCase();
  if (/озон|ozon|маркетплейс/.test(normalized)) return "ozon";
  if (/продав|мне|мой|seller|пвз/.test(normalized)) return "seller";
  return "unknown";
}

function warehouseValue(value: unknown, sheetName: string): "seller" | "ozon" | null {
  const normalized = `${text(value)} ${sheetName}`.toLowerCase();
  if (/ozon|озон/.test(normalized)) return "ozon";
  if (/seller|продав|мой склад|у меня/.test(normalized)) return "seller";
  return null;
}

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const { batchId } = await parseBody(request, requestSchema);
    const result = await db.transaction(async (tx) => {
      const [initialBatch] = await tx.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1);
      if (!initialBatch) throw new Error("Пакет переноса не найден.");
      const lockKey = initialBatch.contentHash ?? initialBatch.id;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

      const [batch] = await tx.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1);
      if (!batch) throw new Error("Пакет переноса не найден.");
      if (batch.status !== "preview") throw new Error("Этот пакет уже обработан; повторный перенос заблокирован.");
      if (batch.contentHash) {
        const appliedBatches = await tx.select({ id: importBatches.id, contentHash: importBatches.contentHash, status: importBatches.status })
          .from(importBatches)
          .where(and(eq(importBatches.contentHash, batch.contentHash), eq(importBatches.status, "applied"), ne(importBatches.id, batch.id)));
        const duplicate = findPreviouslyAppliedBatch(batch, appliedBatches);
        if (duplicate) throw new Error("Файл с таким содержимым уже был перенесён; повторное применение не изменит инвентаризационные корректировки.");
      }
      const rows = await tx.select().from(importRows).where(eq(importRows.batchId, batchId)).orderBy(importRows.sheetName, importRows.rowNumber);
      const imported: Record<string, number> = {};
      const issues: { sheet: string; row: number; message: string }[] = [];
      const addImported = (type: string) => { imported[type] = (imported[type] ?? 0) + 1; };
      const addIssue = async (row: typeof rows[number], message: string) => {
        issues.push({ sheet: row.sheetName, row: row.rowNumber, message });
        await tx.update(importRows).set({ issue: message }).where(eq(importRows.id, row.id));
      };
      const findProduct = async (sku: string) => {
        if (!sku) return null;
        const [product] = await tx.select().from(products).where(eq(products.sku, sku)).limit(1);
        return product ?? null;
      };

      for (const row of rows.filter((item) => item.rowType === "products")) {
        const data = row.data as StoredRow;
        const sku = productSku(data).slice(0, 100);
        if (!sku) { await addIssue(row, "Не найден SKU товара."); continue; }
        const explicitTitle = text(cell(data, ["название товара", "наименование", "название", "товар", "product name"]));
        const descriptor = [cell(data, ["цвет", "color"]), cell(data, ["размер", "размер / длина", "size"]), cell(data, ["модель", "model"])].map(text).filter(Boolean).join(" · ");
        const title = (explicitTitle || descriptor || sku).slice(0, 300);
        const category = (row.sheetName || "Без категории").slice(0, 120);
        const [created] = await tx.insert(products).values({ sku, title, category }).onConflictDoNothing({ target: products.sku }).returning();
        const product = created ?? await findProduct(sku);
        if (!product) { await addIssue(row, "Не удалось создать или найти товар."); continue; }
        const offerId = text(cell(data, ["offer id", "артикул продавца", "карточка", "артикул", "seller sku"])) || sku;
        const ozonSku = text(cell(data, ["ozon sku", "sku ozon", "sku озон", "идентификатор ozon"]));
        if (offerId) await tx.insert(productLinks).values({ productId: product.id, offerId: offerId.slice(0, 120), ozonSku: ozonSku || null }).onConflictDoNothing();
        addImported("products");
      }

      for (const row of rows.filter((item) => item.rowType === "purchases")) {
        const data = row.data as StoredRow;
        const product = await findProduct(productSku(data));
        const quantity = quantityValue(cell(data, ["количество", "кол-во", "qty", "quantity"]));
        const unitCost = amountValue(data, ["цена за единицу", "цена за 1", "цена", "unit cost"]);
        const total = amountValue(data, ["сумма", "стоимость закупки", "итого", "amount"]);
        const purchasedAt = dateValue(data, ["дата закупки", "дата", "создано", "изменено", "purchase date"]);
        if (!product || quantity <= 0 || (unitCost === null && total === null) || !purchasedAt) {
          const message = !product ? "Товар закупки не найден в каталоге." : quantity <= 0 || (unitCost === null && total === null) ? "Не найдены количество и стоимость закупки." : "Дата закупки не найдена; строка не перенесена, чтобы не назначать вымышленную дату.";
          await addIssue(row, message);
          continue;
        }
        const paid = total ?? quantity * (unitCost ?? 0);
        const [purchase] = await tx.insert(purchases).values({
          productId: product.id,
          purchasedAt,
          orderedQuantity: String(quantity),
          amountPaid: String(paid),
          note: text(cell(data, ["примечание", "комментарий", "источник", "ссылка"])) .slice(0, 2000),
          sourceKey: sourceKey(row, batch.contentHash),
        }).onConflictDoUpdate({ target: purchases.sourceKey, set: { productId: product.id, purchasedAt, orderedQuantity: String(quantity), amountPaid: String(paid) } }).returning();
        const receivedValue = cell(data, ["получено количество", "получено", "received quantity", "received"]);
        const receivedQuantity = parseImportMoney(receivedValue) ?? (yes(receivedValue) ? quantity : 0);
        if (receivedQuantity > 0) {
          const receiptAt = dateValue(data, ["дата получения", "дата приемки", "дата приёмки", "received date"]);
          if (!receiptAt) {
            await addIssue(row, "Закупка перенесена, но дата её получения отсутствует; приёмка пропущена, чтобы не менять остаток по вымышленной дате.");
            addImported("purchases");
            continue;
          }
          const receiptUnitCost = unitCost ?? paid / quantity;
          await tx.insert(purchaseReceipts).values({ purchaseId: purchase.id, receivedAt: receiptAt, receivedQuantity: String(Math.min(receivedQuantity, quantity)), unitCost: String(receiptUnitCost), sourceKey: sourceKey(row, batch.contentHash, "receipt") })
            .onConflictDoUpdate({ target: purchaseReceipts.sourceKey, set: { purchaseId: purchase.id, receivedAt: receiptAt, receivedQuantity: String(Math.min(receivedQuantity, quantity)), unitCost: String(receiptUnitCost) } });
        }
        addImported("purchases");
      }

      for (const row of rows.filter((item) => item.rowType === "expenses")) {
        const data = row.data as StoredRow;
        const amount = amountValue(data, ["сумма", "стоимость", "расход", "amount"]);
        if (amount === null) { await addIssue(row, "Не найдена сумма расхода."); continue; }
        const spentAt = dateValue(data, ["дата расхода", "дата", "spent at"]);
        if (!spentAt) { await addIssue(row, "Дата расхода не найдена; строка не перенесена, чтобы не назначать вымышленную дату."); continue; }
        const category = text(cell(data, ["категория", "статья", "название расхода", "что", "комментарий", "расход"])).slice(0, 120) || "Импортированный расход";
        const note = text(cell(data, ["примечание", "комментарий", "описание", "ссылка"])).slice(0, 2000);
        await tx.insert(expenses).values({ spentAt, category, amount: String(amount), note, sourceKey: sourceKey(row, batch.contentHash) })
          .onConflictDoUpdate({ target: expenses.sourceKey, set: { spentAt, category, amount: String(amount), note } });
        addImported("expenses");
      }

      const supplyGroups = new Map<string, { first: typeof rows[number]; rows: typeof rows; at: string | null; shippingCost: number; lines: Map<string, number>; note: string }>();
      let lastSupplyIdBySheet = new Map<string, string>();
      for (const row of rows.filter((item) => item.rowType === "supplies")) {
        const data = row.data as StoredRow;
        const sourceDate = dateValue(data, ["дата поставки", "дата", "supplied at"]);
        const firstHeader = normalizeImportHeader(data.headers[0] ?? "");
        const firstColumnId = /supplyid|shipmentid|номерпоставки|идентификаторпоставки/.test(firstHeader) ? text(valueAt(data, 0)) : "";
        const explicitId = text(cell(data, ["supply id", "номер поставки", "shipment id"])) || firstColumnId;
        const id = explicitId || sourceDate || lastSupplyIdBySheet.get(row.sheetName) || `${row.sheetName}:${row.rowNumber}`;
        lastSupplyIdBySheet.set(row.sheetName, id);
        const key = `${row.sheetName}:${id}`;
        const group = supplyGroups.get(key) ?? { first: row, rows: [], at: sourceDate, shippingCost: 0, lines: new Map<string, number>(), note: `Импортированная поставка ${id}` };
        group.rows.push(row);
        if (!group.at && sourceDate) group.at = sourceDate;
        group.shippingCost += getSupplyShippingCost(data);
        const repeatedProductColumns = data.headers.filter((header) => normalizeImportHeader(header) === "товар").length >= 3;
        const sku = text(repeatedProductColumns ? valueAt(data, 4) : cell(data, ["sku", "артикул", "карточка", "код товара", "товар"]));
        const quantity = quantityValue(repeatedProductColumns ? valueAt(data, 6) : cell(data, ["количество", "кол-во", "qty", "quantity"]));
        if (sku && quantity > 0) group.lines.set(sku, (group.lines.get(sku) ?? 0) + quantity);
        const note = text(cell(data, ["примечание", "комментарий", "note"]));
        if (note) group.note = note;
        supplyGroups.set(key, group);
      }
      for (const [key, group] of supplyGroups) {
        if (!group.at) {
          for (const row of group.rows) await addIssue(row, "Дата поставки не найдена; операция не перенесена, чтобы не назначать вымышленную дату.");
          continue;
        }
        const src = makeImportSourceKey(batch.contentHash, `supply:${key}`);
        const [supply] = await tx.insert(supplies).values({ suppliedAt: group.at, shippingCost: String(group.shippingCost), note: group.note.slice(0, 2000), sourceKey: src })
          .onConflictDoUpdate({ target: supplies.sourceKey, set: { suppliedAt: group.at, shippingCost: String(group.shippingCost), note: group.note.slice(0, 2000) } }).returning();
        await tx.delete(supplyLines).where(and(eq(supplyLines.supplyId, supply.id), like(supplyLines.sourceKey, "import:%")));
        let lineIndex = 0;
        for (const [sku, quantity] of group.lines) {
          const product = await findProduct(sku);
          if (!product) { await addIssue(group.first, `Товар ${sku} из поставки не найден в каталоге.`); continue; }
          await tx.insert(supplyLines).values({ supplyId: supply.id, productId: product.id, quantity: String(quantity), sourceKey: `${src}:line:${lineIndex++}`.slice(0, 240) });
        }
        addImported("supplies");
      }

      for (const row of rows.filter((item) => item.rowType === "writeoffs")) {
        const data = row.data as StoredRow;
        const reason = text(cell(data, ["причина", "тип", "источник", "списание"]));
        if (/ozon|озон/i.test(reason)) { await addIssue(row, "Списание Ozon не перенесено: его нужно загрузить через синхронизацию API."); continue; }
        const product = await findProduct(productSku(data));
        const quantity = quantityValue(cell(data, ["количество", "кол-во", "списано", "qty", "quantity"]));
        if (!product || quantity <= 0) { await addIssue(row, !product ? "Товар списания не найден в каталоге." : "Не найдено количество списания."); continue; }
        const writtenOffAt = dateValue(data, ["дата списания", "дата", "date"]);
        if (!writtenOffAt) { await addIssue(row, "Дата списания не найдена; строка не перенесена, чтобы не назначать вымышленную дату."); continue; }
        await tx.insert(manualWriteoffs).values({ productId: product.id, writtenOffAt, quantity: String(quantity), note: reason.slice(0, 2000), sourceKey: sourceKey(row, batch.contentHash) })
          .onConflictDoUpdate({ target: manualWriteoffs.sourceKey, set: { productId: product.id, writtenOffAt, quantity: String(quantity), note: reason.slice(0, 2000) } });
        addImported("writeoffs");
      }

      const saleSources: SaleSource[] = [];
      for (const row of rows.filter((item) => item.rowType === "sales")) {
        const data = row.data as StoredRow;
        const orderId = text(cell(data, ["posting number", "номер отправления", "id заказа", "id", "заказ"]));
        const sku = productSku(data);
        const status = statusValue(cell(data, ["статус", "status"]));
        const quantity = quantityValue(cell(data, ["количество", "кол-во", "qty", "quantity"]), 1);
        const amount = amountValue(data, ["сумма", "выплата", "доход", "amount"]);
        const orderDate = dateValue(data, ["дата заказа", "дата создания", "создано", "дата", "order date", "created at"]);
        const deliveredAt = dateValue(data, ["дата доставки покупателю", "дата доставки", "дата вручения", "buyer delivery date", "delivered at", "дата"]);
        if (!sku || quantity <= 0) { await addIssue(row, !sku ? "Не найден артикул продажи." : "Некорректное количество продажи."); continue; }
        if (!orderDate && !deliveredAt) { await addIssue(row, "Дата заказа не найдена; строка не перенесена, чтобы не назначать вымышленную дату."); continue; }
        if (isDelivered(status) && !deliveredAt) { await addIssue(row, "Дата передачи покупателю не найдена; доставленный заказ не перенесён, чтобы не начать 21-дневный срок с неверной даты."); continue; }
        saleSources.push({ row, data, orderId: orderId || `legacy:${row.sheetName}:${row.rowNumber}`, productSku: sku, status, quantity, amount, orderDate: orderDate ?? deliveredAt, deliveredAt });
      }
      const saleGroups = new Map<string, SaleSource[]>();
      for (const sale of saleSources) saleGroups.set(sale.orderId, [...(saleGroups.get(sale.orderId) ?? []), sale]);
      for (const [orderId, group] of saleGroups) {
        const chosenBySku = new Map<string, SaleSource>();
        for (const sale of group) {
          const previous = chosenBySku.get(sale.productSku);
          if (!previous || sale.row.rowNumber >= previous.row.rowNumber) chosenBySku.set(sale.productSku, sale);
        }
        const lines = [...chosenBySku.values()];
        const delivered = lines.filter((sale) => isDelivered(sale.status));
        const status = delivered.length ? "delivered" : lines.at(-1)?.status ?? "unknown";
        const deliveredAt = delivered.map((sale) => sale.deliveredAt).filter((date): date is string => Boolean(date)).sort()[0] ?? null;
        const orderDate = lines.map((sale) => sale.orderDate).filter((date): date is string => Boolean(date)).sort()[0] ?? deliveredAt;
        if (!orderDate) {
          for (const sale of lines) await addIssue(sale.row, "Дата заказа не найдена; группа отправления не перенесена.");
          continue;
        }
        const mappedLines = [] as { sale: SaleSource; productId: string }[];
        for (const sale of lines) {
          const product = await findProduct(sale.productSku);
          if (!product) { await addIssue(sale.row, `Товар ${sale.productSku} из продажи не найден в каталоге.`); continue; }
          mappedLines.push({ sale, productId: product.id });
        }
        if (!mappedLines.length) continue;
        const [existing] = await tx.select().from(postings).where(eq(postings.externalId, orderId)).limit(1);
        if (existing && (existing.raw as Record<string, unknown>).source !== "legacy-import") {
          for (const line of lines) await addIssue(line.row, "Продажа уже поступила из Ozon API; импортная строка не заменяет источник API.");
          continue;
        }
        const [posting] = await tx.insert(postings).values({
          externalId: orderId,
          orderNumber: orderId,
          status,
          orderDate: new Date(`${orderDate}T00:00:00.000Z`),
          deliveredAt: deliveredAt ? new Date(`${deliveredAt}T00:00:00.000Z`) : null,
          isMarketplaceBuyout: lines.some((sale) => /выкуп.*маркетплейс|marketplace buyout/i.test(sale.status)),
          raw: { source: "legacy-import", sheets: [...new Set(lines.map((sale) => sale.row.sheetName))] },
          updatedAt: new Date(),
        }).onConflictDoUpdate({
          target: postings.externalId,
          set: { orderNumber: orderId, status, orderDate: new Date(`${orderDate}T00:00:00.000Z`), deliveredAt: deliveredAt ? new Date(`${deliveredAt}T00:00:00.000Z`) : null, raw: { source: "legacy-import" }, updatedAt: new Date() },
        }).returning();
        await tx.delete(postingItems).where(and(eq(postingItems.postingId, posting.id), like(postingItems.sourceKey, "import:%")));
        for (const { sale, productId } of mappedLines) {
          const rowKey = sourceKey(sale.row, batch.contentHash);
          await tx.insert(postingItems).values({
            postingId: posting.id,
            externalKey: `legacy:${sale.row.sheetName}:${sale.row.rowNumber}`.slice(0, 240),
            sourceKey: `${rowKey}:sale-line`,
            productId,
            offerId: sale.productSku,
            title: sale.productSku,
            quantity: String(sale.quantity),
            price: String(Math.max(0, sale.amount ?? 0)),
            movementEnabled: isDelivered(sale.status),
            raw: { source: "legacy-import", sheet: sale.row.sheetName, row: sale.row.rowNumber, status: sale.status },
          });
          if (sale.amount !== null) {
            const accruedDate = sale.deliveredAt ?? sale.orderDate ?? orderDate;
            const financeKey = `legacy-sale:${orderId}:${sale.productSku}`.slice(0, 240);
            await tx.insert(financeAccruals).values({
              externalKey: financeKey,
              accrualDate: accruedDate,
              postingNumber: orderId,
              accrualId: "imported",
              accruedCategory: "POSTING",
              amount: String(sale.amount),
              raw: { source: "legacy-import", sheet: sale.row.sheetName, row: sale.row.rowNumber },
            }).onConflictDoUpdate({ target: financeAccruals.externalKey, set: { accrualDate: accruedDate, amount: String(sale.amount), raw: { source: "legacy-import", sheet: sale.row.sheetName, row: sale.row.rowNumber } } });
          }
          addImported("sales");
        }
      }

      const stocktakeGroups = new Map<string, { first: typeof rows[number]; warehouse: "seller" | "ozon"; countedAt: string; lines: { productId: string; expected: number; actual: number; source: string }[] }>();
      for (const row of rows.filter((item) => item.rowType === "stocktakes")) {
        const data = row.data as StoredRow;
        const warehouse = warehouseValue(cell(data, ["warehouse", "склад", "место хранения"]), row.sheetName);
        const product = await findProduct(productSku(data));
        const actual = quantityValue(cell(data, ["фактическое количество", "фактический остаток", "факт", "actual quantity", "пересчитано"]), -1);
        if (!warehouse || !product || actual < 0) { await addIssue(row, !warehouse ? "Не указан склад для инвентаризации." : !product ? "Товар инвентаризации не найден в каталоге." : "Не найдено фактическое количество."); continue; }
        const countedAt = dateValue(data, ["дата инвентаризации", "дата пересчета", "дата пересчёта", "дата", "counted at"]);
        if (!countedAt) { await addIssue(row, "Дата инвентаризации не найдена; строка не перенесена, чтобы не назначать вымышленную дату."); continue; }
        const key = `${row.sheetName}:${warehouse}:${countedAt}`;
        const group = stocktakeGroups.get(key) ?? { first: row, warehouse, countedAt, lines: [] };
        const expected = quantityValue(cell(data, ["ожидаемый остаток", "расчетный остаток", "расчётный остаток", "expected quantity"]));
        group.lines.push({ productId: product.id, expected, actual, source: sourceKey(row, batch.contentHash) });
        stocktakeGroups.set(key, group);
      }
      for (const [key, group] of stocktakeGroups) {
        const [stocktake] = await tx.insert(stocktakes).values({ warehouse: group.warehouse, countedAt: group.countedAt, note: `Импортирована инвентаризация ${key}`, sourceKey: makeImportSourceKey(batch.contentHash, `stocktake:${key}`) })
          .onConflictDoUpdate({ target: stocktakes.sourceKey, set: { warehouse: group.warehouse, countedAt: group.countedAt } }).returning();
        await tx.delete(stocktakeLines).where(and(eq(stocktakeLines.stocktakeId, stocktake.id), like(stocktakeLines.sourceKey, "import:%")));
        for (const line of group.lines) await tx.insert(stocktakeLines).values({ stocktakeId: stocktake.id, productId: line.productId, expectedQuantity: String(line.expected), actualQuantity: String(line.actual), sourceKey: line.source });
        addImported("stocktakes");
      }

      for (const row of rows.filter((item) => item.rowType === "returns")) {
        const data = row.data as StoredRow;
        const product = await findProduct(productSku(data));
        const quantity = quantityValue(cell(data, ["количество", "кол-во", "qty", "quantity"]), 1);
        if (!product || quantity <= 0) { await addIssue(row, !product ? "Товар возврата не найден в каталоге." : "Не найдено количество возврата."); continue; }
        const destination = returnDestination(cell(data, ["куда возвращен", "куда возвращён", "получатель", "склад", "destination"]));
        const returnedAtText = parseImportDate(cell(data, ["дата возврата", "дата", "returned at"]));
        const receivedAtText = parseImportDate(cell(data, ["дата получения продавцом", "получен продавцом", "received by seller"]));
        const availableAtText = parseImportDate(cell(data, ["дата доступности ozon", "доступен на ozon", "available at ozon"]));
        const id = sourceKey(row, batch.contentHash);
        await tx.insert(returns).values({
          externalId: `legacy-return:${id}`.slice(0, 240),
          postingNumber: text(cell(data, ["номер отправления", "posting number", "id заказа", "id"])) || null,
          externalKey: `offer:${product.sku}|sku:?`,
          productId: product.id,
          offerId: product.sku,
          quantity: String(quantity),
          destination,
          status: statusValue(cell(data, ["статус", "status"])) || "imported",
          returnedAt: returnedAtText ? new Date(`${returnedAtText}T00:00:00.000Z`) : null,
          receivedBySellerAt: receivedAtText ? new Date(`${receivedAtText}T00:00:00.000Z`) : null,
          availableAtOzon: availableAtText ? new Date(`${availableAtText}T00:00:00.000Z`) : null,
          raw: { source: "legacy-import", sheet: row.sheetName, row: row.rowNumber },
        }).onConflictDoNothing();
        addImported("returns");
      }

      for (const row of rows.filter((item) => item.rowType === "unknown")) {
        await addIssue(row, "Тип данных не распознан; строка сохранена в отчёте и не перенесена.");
      }

      const summary = { ...(batch.summary as Record<string, unknown>), applied: imported, issues: issues.length, issueRows: issues.slice(0, 200) };
      await tx.update(importBatches).set({ status: "applied", summary, appliedAt: new Date() }).where(eq(importBatches.id, batchId));
      return { batchId, imported, skippedRows: issues.length, issues: issues.slice(0, 200) };
    });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
