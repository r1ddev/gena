import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
const stocktakeCsv = `SKU,Warehouse,Counted At,Expected Quantity,Actual Quantity\n${mappedSku},seller,${today},0,5\n`;
const stocktakeHash = createHash("sha256").update(stocktakeCsv).digest("hex");

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

async function uploadStocktake() {
  const form = new FormData();
  form.set("file", new File([stocktakeCsv], `stocktakes-smoke-${tag}.csv`, { type: "text/csv" }));
  const { payload } = await api("/api/import", { method: "POST", form, expectedStatus: 201 });
  assert.equal(payload.summary.byType.stocktakes, 1);
  return payload.batchId;
}

async function applyBatchConcurrently(batchId) {
  const responses = await Promise.all([1, 2].map(() => fetch(`${base}/api/import/apply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ batchId }),
  })));
  const statuses = responses.map((response) => response.status).sort((left, right) => left - right);
  assert.deepEqual(statuses, [200, 400], "exactly one concurrent import request should apply the batch");
  const failures = await Promise.all(responses.filter((response) => response.status !== 200).map((response) => response.json()));
  assert.match(failures[0].error, /уже обработан/);
}

async function cleanup() {
  const testSkus = `${sqlValue(productSku)}, ${sqlValue(mappedSku)}, ${sqlValue(mappedSkuB)}`;
  await psql(`DELETE FROM manual_writeoffs WHERE product_id IN (SELECT id FROM products WHERE sku IN (${testSkus}));`);
  await psql(`DELETE FROM stocktakes st USING stocktake_lines sl, products p WHERE st.id=sl.stocktake_id AND sl.product_id=p.id AND p.sku IN (${testSkus});`);
  await psql(`DELETE FROM supplies WHERE id IN (SELECT sl.supply_id FROM supply_lines sl JOIN products p ON p.id=sl.product_id WHERE p.sku IN (${testSkus}));`);
  await psql(`DELETE FROM purchases WHERE product_id IN (SELECT id FROM products WHERE sku IN (${testSkus}));`);
  await psql(`DELETE FROM expenses WHERE category=${sqlValue(`Smoke test ${tag}`)};`);
  await psql(`DELETE FROM ozon_finance_accruals WHERE external_key LIKE ${sqlValue(`smoke-finance:${tag}:%`)};`);
  await psql(`DELETE FROM external_items WHERE external_key LIKE ${sqlValue(`smoke-external:${tag}:%`)};`);
  await psql(`DELETE FROM import_batches WHERE content_hash=${sqlValue(stocktakeHash)};`);
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
    assert.equal(dashboard.sharedExpenseCoefficient, "0.20");
    assert.equal(dashboard.products.find((item) => item.sku === productSku).sellerStock, "0.000");
    assert.equal(dashboard.products.find((item) => item.sku === productSku).ozonStock, "1.000");

    await psql(`DELETE FROM manual_writeoffs WHERE id=${sqlValue(writeoff.id)};`);
    dashboard = (await api("/api/dashboard")).payload;
    assert.equal(dashboard.confirmedProfit, "0.00");
    assert.equal(dashboard.products.find((item) => item.sku === productSku).sellerStock, "1.000");

    await psql(`DELETE FROM supplies WHERE id=${sqlValue(supply.id)};`);
    dashboard = (await api("/api/dashboard")).payload;
    assert.equal(dashboard.cashBalance, "-110.00");
    assert.equal(dashboard.sharedExpenseCoefficient, "0.10");
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
    const importedProductId = await psql(`SELECT id FROM products WHERE sku=${sqlValue(mappedSku)} LIMIT 1;`);
    assert.ok(importedProductId);
    dashboard = (await api("/api/dashboard")).payload;
    assert.equal(dashboard.products.find((item) => item.sku === mappedSku).sellerStock, "5.000");

    console.log("Local integration smoke passed: balance breakdown, direct-delete recalculation, exact-SKU finance mapping, concurrent import protection, and repeat-import protection.");
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
