import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envText = await readFile(resolve(root, ".env"), "utf8").catch(() => "");
const port = envText.match(/^APP_PORT=(\d+)$/m)?.[1] ?? "3000";
const base = `http://localhost:${port}`;
const tag = randomUUID().slice(0, 8);
const productSku = `SMOKE-${tag}`;
const mappedSku = `MAP-${tag}`;
const mappedSkuB = `MAP-B-${tag}`;
const ozonSku = `OZ-${tag}`;
const ozonSkuB = `OZ-B-${tag}`;
const today = new Date().toISOString().slice(0, 10);
const dateDaysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const stocktakeWorkbookCache = new Map();
const supplyWorkbookCache = new Map();

async function api(path, { method = "GET", body, form, expectedStatus = 200 } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    ...(form ? { body: form } : body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  assert.equal(response.status, expectedStatus, `${method} ${path}: ${JSON.stringify(payload)}`);
  return { response, payload };
}

function psql(query) {
  return new Promise((resolveQuery, rejectQuery) => {
    const child = spawn("docker", ["compose", "exec", "-T", "db", "sh", "-lc", 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$1"', "_", query], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectQuery);
    child.once("close", (code) => code === 0 ? resolveQuery(stdout.trim()) : rejectQuery(new Error(stderr.trim() || `psql exited ${code}`)));
  });
}

function sqlValue(value) { return `'${String(value).replaceAll("'", "''")}'`; }

async function stocktakeWorkbook(actualQuantity, sheetName = "Stocktake") {
  const cacheKey = `${actualQuantity}:${sheetName}`;
  if (!stocktakeWorkbookCache.has(cacheKey)) {
    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date("2020-01-01T00:00:00.000Z");
    workbook.modified = new Date("2020-01-01T00:00:00.000Z");
    const sheet = workbook.addWorksheet(sheetName);
    sheet.addRow(["SKU", "Warehouse", "Counted At", "Expected Quantity", "Actual Quantity"]);
    sheet.addRow([mappedSku, "seller", today, 0, actualQuantity]);
    stocktakeWorkbookCache.set(cacheKey, Buffer.from(await workbook.xlsx.writeBuffer()));
  }
  return stocktakeWorkbookCache.get(cacheKey);
}

async function uploadStocktake(actualQuantity = 5, fileName = `stocktakes-smoke-${tag}.xlsx`, sheetName = "Stocktake") {
  const form = new FormData();
  form.set("file", new File([await stocktakeWorkbook(actualQuantity, sheetName)], fileName, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const { payload } = await api("/api/import", { method: "POST", form, expectedStatus: 201 });
  assert.equal(payload.summary.byType.stocktakes, 1);
  return payload.batchId;
}

async function uploadCustomStocktake({ fileName, sheetName, countedAt, sku = mappedSku, actualQuantities, includeWarehouse = true }) {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date("2020-01-01T00:00:00.000Z");
  workbook.modified = new Date("2020-01-01T00:00:00.000Z");
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(["SKU", ...(includeWarehouse ? ["Warehouse"] : []), "Counted At", "Expected Quantity", "Actual Quantity"]);
  for (const actual of actualQuantities) sheet.addRow([sku, ...(includeWarehouse ? ["seller"] : []), countedAt, 0, actual]);
  const form = new FormData();
  form.set("file", new File([Buffer.from(await workbook.xlsx.writeBuffer())], fileName, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const { payload } = await api("/api/import", { method: "POST", form, expectedStatus: 201 });
  return payload.batchId;
}

async function uploadAmbiguousStocktake(fileName, countedAt) {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date("2020-01-01T00:00:00.000Z");
  workbook.modified = new Date("2020-01-01T00:00:00.000Z");
  for (const sheetName of ["Seller physical inventory", "Ozon physical inventory"]) {
    const sheet = workbook.addWorksheet(sheetName);
    sheet.addRow(["SKU", "Counted At", "Expected Quantity", "Actual Quantity"]);
    sheet.addRow([mappedSkuB, countedAt, 0, 0]);
  }
  const form = new FormData();
  form.set("file", new File([Buffer.from(await workbook.xlsx.writeBuffer())], fileName, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const { payload } = await api("/api/import", { method: "POST", form, expectedStatus: 201 });
  return payload.batchId;
}

async function uploadLegacyReturn(fileName, sheetName) {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date("2020-01-01T00:00:00.000Z");
  workbook.modified = new Date("2020-01-01T00:00:00.000Z");
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(["Return ID", "SKU", "Quantity", "Return Date", "Destination", "Posting Number", "Received by Seller"]);
  sheet.addRow([`SMOKE-RETURN-${tag}-legacy`, mappedSkuB, 1, today, "ozon", `SMOKE-POSTING-${tag}-stale-legacy`, ""]);
  const form = new FormData();
  form.set("file", new File([Buffer.from(await workbook.xlsx.writeBuffer())], fileName, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const { payload } = await api("/api/import", { method: "POST", form, expectedStatus: 201 });
  return payload.batchId;
}

async function uploadMixedStatusSales(fileName, postingNumber) {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date("2020-01-01T00:00:00.000Z");
  workbook.modified = new Date("2020-01-01T00:00:00.000Z");
  const sheet = workbook.addWorksheet("Продажи");
  sheet.addRow(["Номер отправления", "Артикул", "Статус", "Количество", "Сумма", "Дата передачи покупателю"]);
  const handoffDate = dateDaysAgo(30);
  sheet.addRow([postingNumber, mappedSku, "Доставлен", 1, 100, handoffDate]);
  sheet.addRow([postingNumber, mappedSkuB, "Отменён", 1, 400, handoffDate]);
  const form = new FormData();
  form.set("file", new File([Buffer.from(await workbook.xlsx.writeBuffer())], fileName, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const { payload } = await api("/api/import", { method: "POST", form, expectedStatus: 201 });
  assert.equal(payload.summary.byType.sales, 2);
  return payload.batchId;
}

async function supplyWorkbook(sheetName) {
  if (!supplyWorkbookCache.has(sheetName)) {
    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date("2020-01-01T00:00:00.000Z");
    workbook.modified = new Date("2020-01-01T00:00:00.000Z");
    const sheet = workbook.addWorksheet(sheetName);
    sheet.addRow(["Supplied At", "Supply ID", "SKU", "Quantity", "Shipping Cost"]);
    sheet.addRow([today, `SMOKE-${tag}`, mappedSku, 1, 25]);
    supplyWorkbookCache.set(sheetName, Buffer.from(await workbook.xlsx.writeBuffer()));
  }
  return supplyWorkbookCache.get(sheetName);
}

async function uploadSupply(fileName, sheetName) {
  const form = new FormData();
  form.set("file", new File([await supplyWorkbook(sheetName)], fileName, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const { payload } = await api("/api/import", { method: "POST", form, expectedStatus: 201 });
  assert.equal(payload.summary.byType.supplies, 1);
  return payload.batchId;
}

async function uploadExpenseHistory(fileName, { csv, category }) {
  let fileBytes;
  let contentType;
  if (csv) {
    fileBytes = Buffer.from(`Дата расхода,Расход,Сумма\n${today},${category},100`, "utf8");
    contentType = "text/csv";
  } else {
    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date("2020-01-01T00:00:00.000Z");
    workbook.modified = new Date("2020-01-01T00:00:00.000Z");
    const sheet = workbook.addWorksheet("Расходы");
    sheet.addRow(["Дата", "Категория", "Сумма"]);
    sheet.addRow([today, category, 100]);
    fileBytes = Buffer.from(await workbook.xlsx.writeBuffer());
    contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  const form = new FormData();
  form.set("file", new File([fileBytes], fileName, { type: contentType }));
  const { payload } = await api("/api/import", { method: "POST", form, expectedStatus: 201 });
  return payload.batchId;
}

async function applyBatchConcurrently(batchId) {
  const responses = await Promise.all([1, 2].map(() => fetch(`${base}/api/import/apply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ batchId }),
  })));
  const payloads = await Promise.all(responses.map((response) => response.json()));
  const statuses = responses.map((response) => response.status).sort((left, right) => left - right);
  assert.deepEqual(statuses, [200, 400], `exactly one concurrent import request should apply the batch: ${JSON.stringify({ statuses, payloads })}`);
  const failures = payloads.filter((_, index) => responses[index].status !== 200);
  if (!/уже обработан/.test(failures[0].error)) {
    const rows = await psql(`SELECT json_agg(json_build_object('file', b.file_name, 'type', ir.row_type, 'sheet', ir.sheet_name, 'data', ir.data)) FROM import_rows ir JOIN import_batches b ON b.id=ir.batch_id WHERE b.status='applied' AND ir.row_type='stocktakes';`);
    const current = await psql(`SELECT json_agg(data) FROM import_rows WHERE batch_id=${sqlValue(batchId)};`);
    throw new Error(`Concurrent import failed unexpectedly: ${JSON.stringify({ failure: failures[0], appliedRows: rows, currentRows: current })}`);
  }
}

async function cleanup() {
  const testSkus = `${sqlValue(productSku)}, ${sqlValue(mappedSku)}, ${sqlValue(mappedSkuB)}`;
  await psql(`DELETE FROM manual_writeoffs WHERE product_id IN (SELECT id FROM products WHERE sku IN (${testSkus}));`);
  await psql(`DELETE FROM ozon_finance_accruals WHERE posting_number=${sqlValue(`LEGACY-MIXED-STATUS-${tag}`)};`);
  await psql(`DELETE FROM ozon_postings WHERE external_id=${sqlValue(`LEGACY-MIXED-STATUS-${tag}`)};`);
  await psql(`DELETE FROM ozon_returns WHERE external_id LIKE ${sqlValue(`SMOKE-RETURN-${tag}-%`)};`);
  await psql(`DELETE FROM ozon_writeoffs WHERE external_id LIKE ${sqlValue(`SMOKE-WRITEOFF-${tag}-%`)};`);
  await psql(`DELETE FROM ozon_postings WHERE external_id LIKE ${sqlValue(`SMOKE-POSTING-${tag}-%`)};`);
  await psql(`DELETE FROM stocktakes st USING stocktake_lines sl, products p WHERE st.id=sl.stocktake_id AND sl.product_id=p.id AND p.sku IN (${testSkus});`);
  await psql(`DELETE FROM supplies WHERE id IN (SELECT sl.supply_id FROM supply_lines sl JOIN products p ON p.id=sl.product_id WHERE p.sku IN (${testSkus}));`);
  await psql(`DELETE FROM purchases WHERE product_id IN (SELECT id FROM products WHERE sku IN (${testSkus}));`);
  await psql(`DELETE FROM expenses WHERE category=${sqlValue(`Smoke test ${tag}`)};`);
  await psql(`DELETE FROM expenses WHERE category=${sqlValue(`Smoke delivery ${tag}`)};`);
  await psql(`DELETE FROM ozon_finance_accruals WHERE external_key LIKE ${sqlValue(`smoke-finance:${tag}:%`)};`);
  await psql(`DELETE FROM external_items WHERE external_key LIKE ${sqlValue(`smoke-external:${tag}:%`)};`);
  await psql(`DELETE FROM import_batches WHERE file_name IN (${sqlValue(`stocktakes-smoke-${tag}.xlsx`)}, ${sqlValue(`stocktakes-renamed-smoke-${tag}.xlsx`)}, ${sqlValue(`stocktakes-renamed-sheet-smoke-${tag}.xlsx`)}, ${sqlValue(`stocktakes-inferred-smoke-${tag}.xlsx`)}, ${sqlValue(`stocktakes-inferred-renamed-smoke-${tag}.xlsx`)}, ${sqlValue(`stocktakes-conflict-smoke-${tag}.xlsx`)}, ${sqlValue(`stocktakes-ambiguous-smoke-${tag}.xlsx`)}, ${sqlValue(`stocktakes-manual-header-smoke-${tag}.xlsx`)}, ${sqlValue(`returns-smoke-${tag}.xlsx`)}, ${sqlValue(`returns-renamed-sheet-smoke-${tag}.xlsx`)}, ${sqlValue(`supplies-smoke-${tag}.xlsx`)}, ${sqlValue(`supplies-renamed-sheet-smoke-${tag}.xlsx`)}, ${sqlValue(`legacy-mixed-status-smoke-${tag}.xlsx`)}, ${sqlValue(`expense-reimport-smoke-${tag}.xlsx`)}, ${sqlValue(`expense-reimport-smoke-${tag}.csv`)});`);
  await psql(`DELETE FROM products WHERE sku IN (${testSkus});`);
}

async function main() {
  const { payload: baseline } = await api("/api/dashboard");
  if (baseline.products.length || baseline.cashBalance !== "0.00" || baseline.confirmedProfit !== "0.00") {
    throw new Error("Для безопасного интеграционного smoke-прогона нужна пустая локальная база. Данные не изменены.");
  }

  try {
    const { payload: productResponse } = await api("/api/products", {
      method: "POST", expectedStatus: 201,
      body: { sku: productSku, title: "Smoke test item", category: "Test" },
    });
    const product = productResponse.item;
    const { payload: purchaseResponse } = await api("/api/purchases", {
      method: "POST", expectedStatus: 201,
      body: { productId: product.id, purchasedAt: today, orderedQuantity: "2", amountPaid: "100" },
    });
    const purchase = purchaseResponse.item;
    await api("/api/purchases/receipts", {
      method: "POST", expectedStatus: 201,
      body: { purchaseId: purchase.id, receivedAt: today, receivedQuantity: "2", unitCost: "50" },
    });
    const { payload: supplyResponse } = await api("/api/supplies", {
      method: "POST", expectedStatus: 201,
      body: { suppliedAt: today, shippingCost: "10", lines: [{ productId: product.id, quantity: "1" }] },
    });
    const supply = supplyResponse.item;
    const { payload: expenseResponse } = await api("/api/expenses", {
      method: "POST", expectedStatus: 201,
      body: { spentAt: today, category: `Smoke test ${tag}`, amount: "10" },
    });
    const expense = expenseResponse.item;
    const { payload: writeoffResponse } = await api("/api/writeoffs", {
      method: "POST", expectedStatus: 201,
      body: { productId: product.id, writtenOffAt: today, quantity: "1", note: "temporary smoke test" },
    });
    const writeoff = writeoffResponse.item;

    let dashboard = (await api("/api/dashboard")).payload;
    assert.equal(dashboard.cashBalance, "-120.00");
    assert.equal(dashboard.confirmedProfit, "-60.00");
    assert.equal(dashboard.sharedExpenseCoefficient, "0.2000");
    assert.equal(dashboard.products.find((item) => item.sku === productSku).sellerStock, "0.000");
    assert.equal(dashboard.products.find((item) => item.sku === productSku).ozonStock, "1.000");

    await psql(`DELETE FROM manual_writeoffs WHERE id=${sqlValue(writeoff.id)};`);
    dashboard = (await api("/api/dashboard")).payload;
    assert.equal(dashboard.confirmedProfit, "0.00");
    assert.equal(dashboard.products.find((item) => item.sku === productSku).sellerStock, "1.000");

    await psql(`DELETE FROM supplies WHERE id=${sqlValue(supply.id)};`);
    dashboard = (await api("/api/dashboard")).payload;
    assert.equal(dashboard.cashBalance, "-110.00");
    assert.equal(dashboard.sharedExpenseCoefficient, "0.1000");
    assert.equal(dashboard.products.find((item) => item.sku === productSku).sellerStock, "2.000");
    assert.equal(dashboard.products.find((item) => item.sku === productSku).ozonStock, "0.000");

    await psql(`DELETE FROM purchases WHERE id=${sqlValue(purchase.id)};`);
    dashboard = (await api("/api/dashboard")).payload;
    assert.equal(dashboard.cashBalance, "-10.00");
    assert.equal(dashboard.receivedPurchaseValue, "0.00");
    assert.equal(dashboard.products.find((item) => item.sku === productSku).sellerStock, "0.000");
    await psql(`DELETE FROM expenses WHERE id=${sqlValue(expense.id)};`);
    await psql(`DELETE FROM products WHERE id=${sqlValue(product.id)};`);

    const { payload: mappedResponse } = await api("/api/products", {
      method: "POST", expectedStatus: 201,
      body: { sku: mappedSku, title: "Mapping item", category: "Test" },
    });
    const mappedProduct = mappedResponse.item;
    const { payload: mappedResponseB } = await api("/api/products", {
      method: "POST", expectedStatus: 201,
      body: { sku: mappedSkuB, title: "Mapping item B", category: "Test" },
    });
    const mappedProductB = mappedResponseB.item;
    const { payload: mappedPurchaseResponse } = await api("/api/purchases", {
      method: "POST", expectedStatus: 201,
      body: { productId: mappedProduct.id, purchasedAt: today, orderedQuantity: "2", amountPaid: "100" },
    });
    await api("/api/purchases/receipts", {
      method: "POST", expectedStatus: 201,
      body: { purchaseId: mappedPurchaseResponse.item.id, receivedAt: today, receivedQuantity: "2", unitCost: "50" },
    });
    const supplyBatch = await uploadSupply(`supplies-smoke-${tag}.xlsx`, "Supplies");
    const { payload: firstSupplyImport } = await api("/api/import/apply", { method: "POST", body: { batchId: supplyBatch } });
    assert.equal(firstSupplyImport.imported.supplies, 1);
    const renamedSupplyBatch = await uploadSupply(`supplies-renamed-sheet-smoke-${tag}.xlsx`, "Imported supplies");
    const { payload: renamedSupplyImport } = await api("/api/import/apply", { method: "POST", body: { batchId: renamedSupplyBatch } });
    assert.equal(renamedSupplyImport.imported.supplies, 1);
    assert.equal(await psql(`SELECT count(*) FROM supplies s JOIN supply_lines sl ON sl.supply_id=s.id JOIN products p ON p.id=sl.product_id WHERE p.sku=${sqlValue(mappedSku)};`), "1", "renaming a worksheet cannot duplicate the imported supply or its shipping cost");
    let mappedDashboard = (await api("/api/dashboard")).payload;
    assert.equal(mappedDashboard.products.find((item) => item.sku === mappedSku).sellerStock, "1.000");
    assert.equal(mappedDashboard.products.find((item) => item.sku === mappedSku).ozonStock, "1.000");

    const inferredDate = dateDaysAgo(5);
    const inferredBatch = await uploadCustomStocktake({ fileName: `stocktakes-inferred-smoke-${tag}.xlsx`, sheetName: "Seller stocktake", countedAt: inferredDate, sku: mappedSkuB, actualQuantities: [0], includeWarehouse: false });
    const inferredApply = await api("/api/import/apply", { method: "POST", body: { batchId: inferredBatch } });
    assert.equal(inferredApply.payload.imported.stocktakes, 1);
    const renamedInferredBatch = await uploadCustomStocktake({ fileName: `stocktakes-inferred-renamed-smoke-${tag}.xlsx`, sheetName: "Imported count", countedAt: inferredDate, sku: mappedSkuB, actualQuantities: [0], includeWarehouse: false });
    const renamedInferredApply = await api("/api/import/apply", { method: "POST", body: { batchId: renamedInferredBatch } });
    assert.equal(renamedInferredApply.payload.imported.stocktakes, 1, "a renamed sheet reuses the warehouse inferred by the original import");
    assert.equal(await psql(`SELECT count(DISTINCT st.id) FROM stocktakes st JOIN stocktake_lines sl ON sl.stocktake_id=st.id JOIN products p ON p.id=sl.product_id WHERE p.sku=${sqlValue(mappedSkuB)} AND st.counted_at=${sqlValue(inferredDate)};`), "1");

    const ambiguousDate = dateDaysAgo(6);
    const ambiguousBatch = await uploadAmbiguousStocktake(`stocktakes-ambiguous-smoke-${tag}.xlsx`, ambiguousDate);
    const ambiguousApply = await api("/api/import/apply", { method: "POST", body: { batchId: ambiguousBatch } });
    assert.equal(ambiguousApply.payload.imported.stocktakes ?? 0, 0, "identical implicit-warehouse rows across different warehouses are left for review");
    assert.equal(await psql(`SELECT count(*) FROM stocktakes WHERE counted_at=${sqlValue(ambiguousDate)};`), "0");

    const conflictDate = dateDaysAgo(3);
    const conflictingStocktakeBatch = await uploadCustomStocktake({ fileName: `stocktakes-conflict-smoke-${tag}.xlsx`, sheetName: "Stocktake", countedAt: conflictDate, actualQuantities: [4, 5] });
    const conflictingStocktakeApply = await api("/api/import/apply", { method: "POST", body: { batchId: conflictingStocktakeBatch } });
    assert.equal(conflictingStocktakeApply.payload.imported.stocktakes ?? 0, 0, "an inventory group with only conflicting lines is not imported");
    assert.equal(await psql(`SELECT count(*) FROM stocktakes WHERE warehouse='seller' AND counted_at=${sqlValue(conflictDate)};`), "0", "rejected inventory rows do not reserve the warehouse and date");
    await api("/api/stocktakes", { method: "POST", expectedStatus: 201, body: { warehouse: "seller", countedAt: conflictDate, note: "manual count after rejected import", lines: [{ productId: mappedProduct.id, actualQuantity: "0" }] } });
    const manualStocktakeHeader = await psql(`SELECT note || '|' || COALESCE(source_key, '') FROM stocktakes WHERE warehouse='seller' AND counted_at=${sqlValue(conflictDate)};`);
    const addLineToManualStocktakeBatch = await uploadCustomStocktake({ fileName: `stocktakes-manual-header-smoke-${tag}.xlsx`, sheetName: "Seller stocktake extension", countedAt: conflictDate, sku: mappedSkuB, actualQuantities: [0] });
    const addLineToManualStocktake = await api("/api/import/apply", { method: "POST", body: { batchId: addLineToManualStocktakeBatch } });
    assert.equal(addLineToManualStocktake.payload.imported.stocktakes, 1);
    assert.equal(await psql(`SELECT note || '|' || COALESCE(source_key, '') FROM stocktakes WHERE warehouse='seller' AND counted_at=${sqlValue(conflictDate)};`), manualStocktakeHeader, "adding imported lines preserves the manually entered count note and identity");
    assert.equal(await psql(`SELECT count(DISTINCT st.id) FROM stocktakes st JOIN stocktake_lines sl ON sl.stocktake_id=st.id WHERE st.warehouse='seller' AND st.counted_at=${sqlValue(conflictDate)};`), "1");

    const externalKeyA = `smoke-external:${tag}:A`;
    const externalKeyB = `smoke-external:${tag}:B`;
    const financeKeyA = `smoke-finance:${tag}:sku:${ozonSku}`;
    const financeKeyB = `smoke-finance:${tag}:sku:${ozonSkuB}`;
    const externalRaw = JSON.stringify({ item_fees: { fees: [{ sku: ozonSku, fees: [] }, { sku: ozonSkuB, fees: [] }] } });
    const externalIdA = await psql(`INSERT INTO external_items (external_key, offer_id, ozon_sku, title, raw) VALUES (${sqlValue(externalKeyA)}, ${sqlValue(`OFFER-${tag}-A`)}, ${sqlValue(ozonSku)}, 'Mapping item A', '{}') RETURNING id;`);
    const externalIdB = await psql(`INSERT INTO external_items (external_key, offer_id, ozon_sku, title, raw) VALUES (${sqlValue(externalKeyB)}, ${sqlValue(`OFFER-${tag}-B`)}, ${sqlValue(ozonSkuB)}, 'Mapping item B', '{}') RETURNING id;`);
    await psql(`INSERT INTO ozon_finance_accruals (external_key, accrual_date, product_id, accrual_id, accrued_category, amount, raw) VALUES (${sqlValue(financeKeyA)}, ${sqlValue(today)}, NULL, 'id', 'ITEM', '-5.00', ${sqlValue(externalRaw)}::jsonb), (${sqlValue(financeKeyB)}, ${sqlValue(today)}, NULL, 'id', 'ITEM', '-7.00', ${sqlValue(externalRaw)}::jsonb);`);
    await api(`/api/external-items?id=${encodeURIComponent(externalIdA)}`, {
      method: "PATCH", body: { action: "map", productId: mappedProduct.id },
    });
    assert.equal(await psql(`SELECT product_id FROM ozon_finance_accruals WHERE external_key=${sqlValue(financeKeyA)};`), mappedProduct.id);
    assert.equal(await psql(`SELECT product_id FROM ozon_finance_accruals WHERE external_key=${sqlValue(financeKeyB)};`), "");
    await api(`/api/external-items?id=${encodeURIComponent(externalIdB)}`, {
      method: "PATCH", body: { action: "map", productId: mappedProductB.id },
    });
    assert.equal(await psql(`SELECT product_id FROM ozon_finance_accruals WHERE external_key=${sqlValue(financeKeyB)};`), mappedProductB.id);
    await psql(`DELETE FROM ozon_finance_accruals WHERE external_key IN (${sqlValue(financeKeyA)}, ${sqlValue(financeKeyB)});`);
    await psql(`DELETE FROM external_items WHERE external_key IN (${sqlValue(externalKeyA)}, ${sqlValue(externalKeyB)});`);
    const firstBatch = await uploadStocktake();
    await applyBatchConcurrently(firstBatch);
    const stocktakes = (await api("/api/stocktakes")).payload.items;
    const importedTake = stocktakes.find((item) => item.lines.some((stocktakeLine) => stocktakeLine.sku === mappedSku));
    assert.ok(importedTake, "imported inventory count is visible");
    const line = importedTake.lines[0];
    await api(`/api/stocktakes?id=${encodeURIComponent(line.id)}`, { method: "PATCH", body: { resolutionNote: "accepted smoke test" } });

    const secondBatch = await uploadStocktake();
    const duplicateApply = await api("/api/import/apply", { method: "POST", body: { batchId: secondBatch }, expectedStatus: 400 });
    assert.match(duplicateApply.payload.error, /уже был перенесён/);
    const refreshed = (await api("/api/stocktakes")).payload.items.find((item) => item.id === importedTake.id);
    assert.ok(refreshed.lines[0].resolvedAt, "re-upload preserves the accepted inventory resolution");
    const renamedSheetBatch = await uploadStocktake(5, `stocktakes-renamed-sheet-smoke-${tag}.xlsx`, "Physical count");
    const { payload: renamedSheetApply } = await api("/api/import/apply", { method: "POST", body: { batchId: renamedSheetBatch } });
    assert.equal(renamedSheetApply.imported.stocktakes, 1);
    assert.equal(await psql(`SELECT count(DISTINCT st.id) FROM stocktakes st JOIN stocktake_lines sl ON sl.stocktake_id=st.id JOIN products p ON p.id=sl.product_id WHERE p.sku=${sqlValue(mappedSku)} AND st.counted_at=${sqlValue(today)};`), "1", "a renamed worksheet cannot duplicate a daily inventory count");
    const renamedSheetTake = (await api("/api/stocktakes")).payload.items.find((item) => item.lines.some((stocktakeLine) => stocktakeLine.sku === mappedSku));
    assert.ok(renamedSheetTake.lines[0].resolvedAt, "renamed-sheet reimport preserves the manual inventory resolution");
    const duplicateManualTake = await api("/api/stocktakes", {
      method: "POST",
      expectedStatus: 400,
      body: { warehouse: "seller", countedAt: today, note: "duplicate smoke test", lines: [{ productId: mappedProduct.id, actualQuantity: "5" }] },
    });
    assert.match(duplicateManualTake.payload.error, /уже существует/);
    const changedBatch = await uploadStocktake(6);
    const changedFileApply = await api("/api/import/apply", { method: "POST", body: { batchId: changedBatch }, expectedStatus: 400 });
    assert.match(changedFileApply.payload.error, /с таким именем уже переносился/);
    const renamedBatch = await uploadStocktake(6, `stocktakes-renamed-smoke-${tag}.xlsx`);
    const renamedFileApply = await api("/api/import/apply", { method: "POST", body: { batchId: renamedBatch }, expectedStatus: 400 });
    assert.match(renamedFileApply.payload.error, /изменились или исчезли строки/);
    const unchangedTake = (await api("/api/stocktakes")).payload.items.find((item) => item.id === importedTake.id);
    assert.equal(unchangedTake.lines[0].actualQuantity, "5.000", "changed same-name import cannot replace a previous line");
    const importedProductId = await psql(`SELECT id FROM products WHERE sku=${sqlValue(mappedSku)} LIMIT 1;`);
    assert.ok(importedProductId);
    dashboard = (await api("/api/dashboard")).payload;
    assert.equal(dashboard.products.find((item) => item.sku === mappedSku).sellerStock, "5.000");

    const returnPostingNumber = `SMOKE-POSTING-${tag}-return`;
    const alternateReturnPostingNumber = `SMOKE-POSTING-${tag}-return-alternate`;
    const mismatchPostingNumber = `SMOKE-POSTING-${tag}-mismatch`;
    const returnExternalId = `SMOKE-RETURN-${tag}-unlinked`;
    const stalePostingNumber = mismatchPostingNumber;
    const insertedPosting = await psql(`INSERT INTO ozon_postings (external_id, order_number, status, order_date, delivered_at, raw) VALUES (${sqlValue(returnPostingNumber)}, ${sqlValue(returnPostingNumber)}, 'delivered', now() - interval '30 days', now() - interval '30 days', '{}') RETURNING id;`);
    const alternatePosting = await psql(`INSERT INTO ozon_postings (external_id, order_number, status, order_date, delivered_at, raw) VALUES (${sqlValue(alternateReturnPostingNumber)}, ${sqlValue(alternateReturnPostingNumber)}, 'delivered', now() - interval '30 days', now() - interval '30 days', '{}') RETURNING id;`);
    const mismatchedPosting = await psql(`INSERT INTO ozon_postings (external_id, order_number, status, order_date, delivered_at, raw) VALUES (${sqlValue(mismatchPostingNumber)}, ${sqlValue(mismatchPostingNumber)}, 'delivered', now() - interval '30 days', now() - interval '30 days', '{}') RETURNING id;`);
    await psql(`INSERT INTO ozon_posting_items (posting_id, external_key, product_id, offer_id, ozon_sku, title, quantity, price, raw) VALUES (${sqlValue(insertedPosting)}, ${sqlValue(`smoke-return:${tag}`)}, ${sqlValue(mappedProductB.id)}, ${sqlValue(mappedSkuB)}, ${sqlValue(ozonSkuB)}, 'Returned item', 2, 300, '{}'), (${sqlValue(alternatePosting)}, ${sqlValue(`smoke-return-alternate:${tag}`)}, ${sqlValue(mappedProductB.id)}, ${sqlValue(mappedSkuB)}, ${sqlValue(ozonSkuB)}, 'Returned item alternate order', 1, 300, '{}'), (${sqlValue(mismatchedPosting)}, ${sqlValue(`smoke-mismatch:${tag}`)}, ${sqlValue(mappedProduct.id)}, ${sqlValue(mappedSku)}, ${sqlValue(ozonSku)}, 'Different item', 1, 300, '{}');`);
    const legacyReturnBatch = await uploadLegacyReturn(`returns-smoke-${tag}.xlsx`, "Returns");
    const legacyReturnImport = await api("/api/import/apply", { method: "POST", body: { batchId: legacyReturnBatch } });
    assert.equal(legacyReturnImport.payload.imported.returns, 1);
    const legacyReturn = (await api("/api/returns")).payload.items.find((item) => item.externalId === `SMOKE-RETURN-${tag}-legacy`);
    assert.ok(legacyReturn, "legacy return import is visible");
    await api(`/api/returns?id=${encodeURIComponent(legacyReturn.id)}`, { method: "PATCH", body: { postingNumber: returnPostingNumber, destination: "seller", receivedBySellerAt: new Date().toISOString() } });
    const renamedReturnBatch = await uploadLegacyReturn(`returns-renamed-sheet-smoke-${tag}.xlsx`, "Imported returns");
    const renamedReturnImport = await api("/api/import/apply", { method: "POST", body: { batchId: renamedReturnBatch } });
    assert.equal(renamedReturnImport.payload.imported.returns, 1);
    const refreshedLegacyReturn = (await api("/api/returns")).payload.items.find((item) => item.externalId === `SMOKE-RETURN-${tag}-legacy`);
    assert.equal(refreshedLegacyReturn.postingNumber, returnPostingNumber, "renamed-sheet reimport preserves a manually linked posting");
    assert.equal(refreshedLegacyReturn.destination, "seller", "reimport preserves the manually selected return destination");
    assert.ok(refreshedLegacyReturn.receivedBySellerAt, "reimport preserves the confirmed receipt date");

    await psql(`INSERT INTO ozon_returns (external_id, posting_number, external_key, product_id, offer_id, ozon_sku, quantity, destination, status, returned_at, received_by_seller_at, raw) VALUES (${sqlValue(returnExternalId)}, ${sqlValue(stalePostingNumber)}, ${sqlValue(`smoke-return:${tag}`)}, ${sqlValue(mappedProductB.id)}, ${sqlValue(mappedSkuB)}, ${sqlValue(ozonSkuB)}, 1, 'seller', 'received', now() - interval '1 day', now() - interval '1 day', '{}');`);
    const unlinkedReturn = (await api("/api/returns")).payload.items.find((item) => item.externalId === returnExternalId);
    assert.ok(unlinkedReturn, "unlinked return is visible for reconciliation");
    assert.equal(unlinkedReturn.postingMatched, false, "a stale posting number is reported as unresolved");
    const mismatchedLink = await api(`/api/returns?id=${encodeURIComponent(unlinkedReturn.id)}`, {
      method: "PATCH", body: { postingNumber: mismatchPostingNumber }, expectedStatus: 400,
    });
    assert.match(mismatchedLink.payload.error, /нет товара из возврата/);
    dashboard = (await api("/api/dashboard")).payload;
    assert.equal(dashboard.confirmedProfit, null, "unlinked received return cannot show a fully confirmed profit");
    assert.ok(dashboard.profitReconciliationIssues.some((issue) => issue.externalId === returnExternalId), "a posting for another product cannot reconcile the return");
    const linkedToAlternateOrder = await api(`/api/returns?id=${encodeURIComponent(unlinkedReturn.id)}`, {
      method: "PATCH", body: { postingNumber: alternateReturnPostingNumber },
    });
    assert.equal(linkedToAlternateOrder.payload.item.postingNumber, alternateReturnPostingNumber);
    assert.equal((await api("/api/returns")).payload.items.find((item) => item.externalId === returnExternalId).postingMatched, true, "a return linked to another order with the same SKU stays editable");
    const linkedReturn = await api(`/api/returns?id=${encodeURIComponent(unlinkedReturn.id)}`, {
      method: "PATCH", body: { postingNumber: returnPostingNumber },
    });
    assert.equal(linkedReturn.payload.item.postingNumber, returnPostingNumber);
    assert.equal((await api("/api/returns")).payload.items.find((item) => item.externalId === returnExternalId).postingMatched, true, "a valid manual link is reported as resolved");
    dashboard = (await api("/api/dashboard")).payload;
    assert.equal(dashboard.profitReconciliationIssues.length, 0, "a return linked to a matching posting clears its reconciliation issue");
    assert.equal(dashboard.products.find((item) => item.sku === mappedSkuB).sellerStock, "2.000");

    const overageReturnId = `SMOKE-RETURN-${tag}-overage`;
    await psql(`INSERT INTO ozon_returns (external_id, posting_number, external_key, product_id, offer_id, ozon_sku, quantity, destination, status, returned_at, received_by_seller_at, raw) VALUES (${sqlValue(overageReturnId)}, ${sqlValue(returnPostingNumber)}, ${sqlValue(`smoke-return:${tag}`)}, ${sqlValue(mappedProductB.id)}, ${sqlValue(mappedSkuB)}, ${sqlValue(ozonSkuB)}, 1, 'seller', 'received', now() - interval '1 day', now() - interval '1 day', '{}');`);
    assert.equal((await api("/api/returns")).payload.items.find((item) => item.externalId === overageReturnId).profitReconciliationNeeded, true, "a matched return exceeding sold quantity is marked on its row");
    dashboard = (await api("/api/dashboard")).payload;
    assert.ok(dashboard.profitReconciliationIssues.some((issue) => issue.externalId === overageReturnId));
    await psql(`DELETE FROM ozon_returns WHERE external_id=${sqlValue(overageReturnId)};`);
    dashboard = (await api("/api/dashboard")).payload;
    assert.equal(dashboard.profitReconciliationIssues.length, 0, "removing the duplicate return recalculates reconciliation");

    const ignoredOzonSku = `UNKNOWN-${tag}`;
    const ignoredOfferId = `UNKNOWN-OFFER-${tag}`;
    const ignoredExternalKey = `smoke-external:${tag}:ignored`;
    const mixedPostingNumber = `SMOKE-POSTING-${tag}-mixed-ignore`;
    const ignoredFinanceKey = `smoke-finance:${tag}:ITEM:${mixedPostingNumber}:ignored:sku:${ignoredOzonSku}`;
    const oldLinkedFinanceKey = `smoke-finance:${tag}:ITEM:old-link:sku:${ignoredOzonSku}:type:15`;
    const knownFinanceKey = `smoke-finance:${tag}:ITEM:${mixedPostingNumber}:known:sku:${ozonSkuB}`;
    const postingFinanceKey = `smoke-finance:${tag}:POSTING:${mixedPostingNumber}`;
    const ignoredFinanceRaw = JSON.stringify({ item_fees: { fees: [{ sku: ignoredOzonSku, fees: [{ type_id: "sale", accrued: "400" }] }] } });
    const oldLinkedFinanceRaw = JSON.stringify({ item_fees: { fees: [{ sku: ignoredOzonSku, fees: [{ type_id: "15", accrued: "-12" }] }] } });
    const knownFinanceRaw = JSON.stringify({ item_fees: { fees: [{ sku: ozonSkuB, fees: [{ type_id: "sale", accrued: "100" }] }] } });
    const ignoredExternalId = await psql(`INSERT INTO external_items (external_key, offer_id, ozon_sku, title, raw) VALUES (${sqlValue(ignoredExternalKey)}, ${sqlValue(ignoredOfferId)}, ${sqlValue(ignoredOzonSku)}, 'Unknown mixed posting item', '{}') RETURNING id;`);
    await psql(`INSERT INTO product_links (product_id, offer_id, ozon_sku) VALUES (${sqlValue(mappedProduct.id)}, ${sqlValue(ignoredOfferId)}, NULL);`);
    const mixedPostingId = await psql(`INSERT INTO ozon_postings (external_id, order_number, status, order_date, delivered_at, raw) VALUES (${sqlValue(mixedPostingNumber)}, ${sqlValue(mixedPostingNumber)}, 'delivered', now() - interval '30 days', now() - interval '30 days', '{}') RETURNING id;`);
    const oldLinkedPostingNumber = `SMOKE-POSTING-${tag}-old-link`;
    const oldLinkedPostingId = await psql(`INSERT INTO ozon_postings (external_id, order_number, status, order_date, delivered_at, raw) VALUES (${sqlValue(oldLinkedPostingNumber)}, ${sqlValue(oldLinkedPostingNumber)}, 'delivered', now() - interval '40 days', now() - interval '40 days', '{}') RETURNING id;`);
    const oldAutoLinkedPostingNumber = `SMOKE-POSTING-${tag}-old-auto-link`;
    const oldAutoLinkedPostingId = await psql(`INSERT INTO ozon_postings (external_id, order_number, status, order_date, delivered_at, raw) VALUES (${sqlValue(oldAutoLinkedPostingNumber)}, ${sqlValue(oldAutoLinkedPostingNumber)}, 'delivered', now() - interval '40 days', now() - interval '40 days', '{}') RETURNING id;`);
    await psql(`INSERT INTO ozon_posting_items (posting_id, external_key, product_id, offer_id, ozon_sku, title, quantity, price, raw) VALUES (${sqlValue(mixedPostingId)}, ${sqlValue(`smoke-mixed-known:${tag}`)}, ${sqlValue(mappedProductB.id)}, ${sqlValue(mappedSkuB)}, ${sqlValue(ozonSkuB)}, 'Known sibling', 1, 100, '{}'), (${sqlValue(mixedPostingId)}, ${sqlValue(ignoredExternalKey)}, NULL, ${sqlValue(ignoredOfferId)}, ${sqlValue(ignoredOzonSku)}, 'Unknown sibling', 1, 400, '{}');`);
    const oldLinkedExternalKey = `offer:${ignoredOfferId}-old|sku:${ignoredOzonSku}`;
    const oldLinkedOfferId = `${ignoredOfferId}-old`;
    await psql(`INSERT INTO product_links (product_id, offer_id, ozon_sku) VALUES (${sqlValue(mappedProductB.id)}, ${sqlValue(oldLinkedOfferId)}, ${sqlValue(ignoredOzonSku)});`);
    await psql(`INSERT INTO ozon_posting_items (posting_id, external_key, product_id, offer_id, ozon_sku, title, quantity, price, raw) VALUES (${sqlValue(oldLinkedPostingId)}, ${sqlValue(oldLinkedExternalKey)}, ${sqlValue(mappedProductB.id)}, ${sqlValue(oldLinkedOfferId)}, ${sqlValue(ignoredOzonSku)}, 'Explicitly linked history', 1, 400, '{}'), (${sqlValue(oldAutoLinkedPostingId)}, ${sqlValue(`offer:${ignoredOfferId}-auto|sku:${ignoredOzonSku}`)}, ${sqlValue(mappedProductB.id)}, ${sqlValue(`${ignoredOfferId}-auto`)}, ${sqlValue(ignoredOzonSku)}, 'Inherited SKU link', 1, 400, '{}');`);
    const oldLinkedReturnId = `SMOKE-RETURN-${tag}-old-link`;
    await psql(`INSERT INTO ozon_returns (external_id, posting_number, external_key, product_id, offer_id, ozon_sku, quantity, destination, status, raw) VALUES (${sqlValue(oldLinkedReturnId)}, ${sqlValue(oldLinkedPostingNumber)}, ${sqlValue(oldLinkedExternalKey)}, ${sqlValue(mappedProductB.id)}, ${sqlValue(oldLinkedOfferId)}, ${sqlValue(ignoredOzonSku)}, 1, 'unknown', 'unknown', '{}');`);
    const oldLinkedWriteoffId = `SMOKE-WRITEOFF-${tag}-old-link`;
    await psql(`INSERT INTO ozon_writeoffs (external_id, product_id, external_key, offer_id, ozon_sku, quantity, compensation_status, compensation_amount, occurred_at, raw) VALUES (${sqlValue(oldLinkedWriteoffId)}, ${sqlValue(mappedProductB.id)}, ${sqlValue(oldLinkedExternalKey)}, ${sqlValue(oldLinkedOfferId)}, ${sqlValue(ignoredOzonSku)}, 1, 'unknown', 0, now() - interval '40 days', '{}');`);
    await psql(`INSERT INTO ozon_finance_accruals (external_key, accrual_date, posting_number, product_id, accrual_id, accrued_category, amount, raw) VALUES (${sqlValue(knownFinanceKey)}, ${sqlValue(today)}, ${sqlValue(mixedPostingNumber)}, ${sqlValue(mappedProductB.id)}, 'known', 'ITEM', '100', ${sqlValue(knownFinanceRaw)}::jsonb), (${sqlValue(ignoredFinanceKey)}, ${sqlValue(today)}, ${sqlValue(mixedPostingNumber)}, NULL, 'ignored', 'ITEM', '400', ${sqlValue(ignoredFinanceRaw)}::jsonb), (${sqlValue(oldLinkedFinanceKey)}, ${sqlValue(today)}, NULL, ${sqlValue(mappedProductB.id)}, 'old-link', 'ITEM', '-12', ${sqlValue(oldLinkedFinanceRaw)}::jsonb), (${sqlValue(postingFinanceKey)}, ${sqlValue(today)}, ${sqlValue(mixedPostingNumber)}, NULL, 'posting', 'POSTING', '-10', '{}');`);
    const beforeIgnoringMixedItem = (await api("/api/dashboard")).payload;
    await api(`/api/external-items?id=${encodeURIComponent(ignoredExternalId)}`, { method: "PATCH", body: { action: "ignore" } });
    const afterIgnoringMixedItem = (await api("/api/dashboard")).payload;
    assert.equal((Number(afterIgnoringMixedItem.cashBalance) - Number(beforeIgnoringMixedItem.cashBalance)).toFixed(2), "90.00", "ignoring one unknown SKU retains mapped sibling finance and posting-level charges");
    assert.equal((Number(beforeIgnoringMixedItem.unrecognizedFinanceAmount) - Number(afterIgnoringMixedItem.unrecognizedFinanceAmount)).toFixed(2), "90.00", "only the ignored item accrual remains unrecognized");
    assert.equal(await psql(`SELECT product_id FROM ozon_posting_items WHERE posting_id=${sqlValue(oldLinkedPostingId)} AND external_key=${sqlValue(oldLinkedExternalKey)};`), mappedProductB.id, "ignoring a SKU preserves history resolved by an exact product link");
    assert.equal(await psql(`SELECT product_id FROM ozon_posting_items WHERE posting_id=${sqlValue(oldAutoLinkedPostingId)};`), "", "ignoring a SKU clears inherited history with no explicit product link");
    assert.equal(await psql(`SELECT product_id FROM ozon_returns WHERE external_id=${sqlValue(oldLinkedReturnId)};`), mappedProductB.id, "ignoring a SKU preserves its explicitly linked return history");
    assert.equal(await psql(`SELECT product_id FROM ozon_writeoffs WHERE external_id=${sqlValue(oldLinkedWriteoffId)};`), mappedProductB.id, "ignoring a SKU preserves its explicitly linked writeoff history");
    assert.equal(await psql(`SELECT product_id FROM ozon_finance_accruals WHERE external_key=${sqlValue(oldLinkedFinanceKey)};`), mappedProductB.id, "a unique explicit link preserves item-level finance attribution");
    assert.equal(await psql(`SELECT product_id FROM product_links WHERE offer_id=${sqlValue(ignoredOfferId)} AND ozon_sku IS NULL;`), mappedProduct.id, "ignoring one SKU keeps the offer-level fallback mapping for other SKUs");

    const compensationSku = `UNKNOWN-COMPENSATION-${tag}`;
    const compensationOfferId = `UNKNOWN-COMPENSATION-OFFER-${tag}`;
    const compensationExternalKey = `smoke-external:${tag}:ignored-compensation`;
    const compensationFinanceKey = `smoke-finance:${tag}:ITEM:ignored-compensation:sku:${compensationSku}:type:10`;
    const compensationFinanceRaw = JSON.stringify({ item_fees: { fees: [{ sku: compensationSku, fees: [{ type_id: "10", accrued: "60" }] }] } });
    const compensationExternalId = await psql(`INSERT INTO external_items (external_key, offer_id, ozon_sku, title, raw) VALUES (${sqlValue(compensationExternalKey)}, ${sqlValue(compensationOfferId)}, ${sqlValue(compensationSku)}, 'Unknown compensated item', '{}') RETURNING id;`);
    await psql(`INSERT INTO ozon_finance_accruals (external_key, accrual_date, product_id, accrual_id, accrued_category, type_id, amount, raw) VALUES (${sqlValue(compensationFinanceKey)}, ${sqlValue(today)}, NULL, 'writeoff-compensation', 'ITEM', '10', '60', ${sqlValue(compensationFinanceRaw)}::jsonb);`);
    const beforeIgnoringCompensation = (await api("/api/dashboard")).payload;
    await api(`/api/external-items?id=${encodeURIComponent(compensationExternalId)}`, { method: "PATCH", body: { action: "ignore" } });
    const afterIgnoringCompensation = (await api("/api/dashboard")).payload;
    assert.equal((Number(afterIgnoringCompensation.cashBalance) - Number(beforeIgnoringCompensation.cashBalance)).toFixed(2), "-60.00", "ignoring an unknown SKU removes its compensation from the main cash balance");
    assert.equal((Number(afterIgnoringCompensation.unrecognizedFinanceAmount) - Number(beforeIgnoringCompensation.unrecognizedFinanceAmount)).toFixed(2), "60.00", "ignored compensation remains visible among unrecognized finance");

    const mixedLegacyPostingNumber = `LEGACY-MIXED-STATUS-${tag}`;
    const beforeMixedLegacyImport = (await api("/api/dashboard")).payload;
    const mixedLegacyBatch = await uploadMixedStatusSales(`legacy-mixed-status-smoke-${tag}.xlsx`, mixedLegacyPostingNumber);
    const mixedLegacyApply = await api("/api/import/apply", { method: "POST", body: { batchId: mixedLegacyBatch } });
    assert.equal(mixedLegacyApply.payload.imported.sales, 2);
    const afterMixedLegacyImport = (await api("/api/dashboard")).payload;
    assert.equal((Number(afterMixedLegacyImport.cashBalance) - Number(beforeMixedLegacyImport.cashBalance)).toFixed(2), "100.00", "only the delivered line amount is recognized in a mixed-status legacy posting");
    assert.equal((Number(afterMixedLegacyImport.unrecognizedFinanceAmount) - Number(beforeMixedLegacyImport.unrecognizedFinanceAmount)).toFixed(2), "400.00", "the cancelled sibling amount remains outside the balance");
    assert.equal(await psql(`SELECT count(*) FROM ozon_finance_accruals WHERE posting_number=${sqlValue(mixedLegacyPostingNumber)} AND accrued_category='ITEM' AND product_id IS NOT NULL;`), "2", "legacy sale money remains attributable to each product line");

    const expenseCategory = `Smoke delivery ${tag}`;
    const xlsxExpenseBatch = await uploadExpenseHistory(`expense-reimport-smoke-${tag}.xlsx`, { csv: false, category: expenseCategory });
    await api("/api/import/apply", { method: "POST", body: { batchId: xlsxExpenseBatch } });
    const csvExpenseBatch = await uploadExpenseHistory(`expense-reimport-smoke-${tag}.csv`, { csv: true, category: expenseCategory });
    await api("/api/import/apply", { method: "POST", body: { batchId: csvExpenseBatch } });
    const importedExpenseEvidence = await psql(`SELECT json_agg(json_build_object('file', b.file_name, 'sheet', ir.sheet_name, 'data', ir.data, 'source_key', e.source_key)) FROM import_rows ir JOIN import_batches b ON b.id=ir.batch_id LEFT JOIN expenses e ON e.category=${sqlValue(expenseCategory)} WHERE b.file_name IN (${sqlValue(`expense-reimport-smoke-${tag}.xlsx`)}, ${sqlValue(`expense-reimport-smoke-${tag}.csv`)});`);
    assert.equal(await psql(`SELECT count(*) FROM expenses WHERE category=${sqlValue(expenseCategory)} AND spent_at=${sqlValue(today)} AND amount='100.00';`), "1", `equivalent CSV and XLSX expense rows share one source identity: ${importedExpenseEvidence}`);

    console.log("Local integration smoke passed: balance breakdown and direct-delete recalculation, exact-SKU finance mapping, mixed-status legacy sales, mixed-product posting ignore behavior, ignored writeoff-compensation exclusion, return reconciliation and reimport preservation, same-SKU explicit-link preservation and inherited-link clearing, concurrent import protection, daily stocktake uniqueness and note preservation, conflict handling, inferred warehouse preservation, cross-format CSV/XLSX deduplication, resolution preservation, and import correction guards.");
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
