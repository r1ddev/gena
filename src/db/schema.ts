import {
  boolean,
  check,
  date,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { OzonCompensationReportLine } from "@/ozon/compensation";

const id = () => uuid("id").defaultRandom().primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const money = (name: string) => numeric(name, { precision: 16, scale: 2 }).notNull();
const quantity = (name: string) => numeric(name, { precision: 14, scale: 3 }).notNull();
const userId = () => uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" });

export const users = pgTable(
  "users",
  {
    id: id(),
    login: text("login").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("users_login_lower_unique_idx").on(sql`lower(${table.login})`)],
);

export const userSessions = pgTable(
  "user_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("user_sessions_user_idx").on(table.userId), index("user_sessions_expiry_idx").on(table.expiresAt)],
);

export const dispositionEnum = pgEnum("external_disposition", ["pending", "mapped", "created", "ignored"]);
export const syncJobStatusEnum = pgEnum("sync_job_status", ["queued", "running", "completed", "failed"]);
export const returnDestinationEnum = pgEnum("return_destination", ["seller", "ozon", "unknown"]);
export const warehouseEnum = pgEnum("warehouse", ["seller", "ozon"]);
export const purchaseStatusEnum = pgEnum("purchase_status", ["open", "completed"]);

export const products = pgTable(
  "products",
  {
    id: id(),
    userId: userId(),
    sku: text("sku").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull().default("Без категории"),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("products_user_sku_unique").on(table.userId, table.sku),
    index("products_archived_title_idx").on(table.archived, table.title),
  ],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const productImages = pgTable("product_images", {
  userId: userId(),
  productId: uuid("product_id").primaryKey().references(() => products.id, { onDelete: "cascade" }),
  contentType: text("content_type").notNull(),
  data: bytea("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const productLinks = pgTable(
  "product_links",
  {
    id: id(),
    userId: userId(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    offerId: text("offer_id").notNull(),
    ozonSku: text("ozon_sku").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check("product_links_identifiers_present_check", sql`${table.offerId} <> '' AND ${table.ozonSku} <> ''`),
    uniqueIndex("product_links_user_product_unique_idx").on(table.userId, table.productId),
    uniqueIndex("product_links_user_offer_id_unique_idx").on(table.userId, table.offerId),
    uniqueIndex("product_links_user_ozon_sku_unique_idx").on(table.userId, table.ozonSku),
  ],
);

export const externalItems = pgTable(
  "external_items",
  {
    id: id(),
    userId: userId(),
    externalKey: text("external_key").notNull(),
    offerId: text("offer_id").notNull().default(""),
    ozonSku: text("ozon_sku").notNull().default(""),
    title: text("title").notNull().default("Без названия"),
    disposition: dispositionEnum("disposition").notNull().default("pending"),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    firstSeenAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("external_items_user_external_key_unique_idx").on(table.userId, table.externalKey), index("external_items_user_disposition_idx").on(table.userId, table.disposition)],
);

export const purchases = pgTable(
  "purchases",
  {
    id: id(),
    userId: userId(),
    productId: uuid("product_id").notNull(),
    productSkuSnapshot: text("product_sku_snapshot").notNull().default(""),
    productTitleSnapshot: text("product_title_snapshot").notNull().default(""),
    purchasedAt: date("purchased_at").notNull(),
    orderedQuantity: quantity("ordered_quantity"),
    amountPaid: money("amount_paid"),
    status: purchaseStatusEnum("status").notNull().default("open"),
    note: text("note").notNull().default(""),
    sourceKey: text("source_key"),
    createdAt: createdAt(),
  },
  (table) => [index("purchases_product_date_idx").on(table.userId, table.productId, table.purchasedAt), uniqueIndex("purchases_user_source_key_unique_idx").on(table.userId, table.sourceKey)],
);

export const purchaseReceipts = pgTable(
  "purchase_receipts",
  {
    id: id(),
    userId: userId(),
    purchaseId: uuid("purchase_id").notNull().references(() => purchases.id, { onDelete: "cascade" }),
    receivedAt: date("received_at").notNull(),
    note: text("note").notNull().default(""),
    sourceKey: text("source_key"),
    createdAt: createdAt(),
  },
  (table) => [index("purchase_receipts_purchase_idx").on(table.userId, table.purchaseId), uniqueIndex("purchase_receipts_user_source_key_unique_idx").on(table.userId, table.sourceKey)],
);

export const purchaseReceiptLines = pgTable(
  "purchase_receipt_lines",
  {
    id: id(),
    userId: userId(),
    receiptId: uuid("receipt_id").notNull().references(() => purchaseReceipts.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(),
    productSkuSnapshot: text("product_sku_snapshot").notNull().default(""),
    productTitleSnapshot: text("product_title_snapshot").notNull().default(""),
    quantity: quantity("quantity"),
    createdAt: createdAt(),
  },
  (table) => [index("purchase_receipt_lines_receipt_idx").on(table.receiptId), index("purchase_receipt_lines_product_idx").on(table.productId)],
);

export const supplies = pgTable("supplies", {
  id: id(),
  userId: userId(),
  suppliedAt: date("supplied_at").notNull(),
  shippingCost: money("shipping_cost"),
  marketplace: text("marketplace").notNull().default("unknown"),
  ozonSupplyId: text("ozon_supply_id"),
  note: text("note").notNull().default(""),
  sourceKey: text("source_key"),
  createdAt: createdAt(),
}, (table) => [
  check("supplies_marketplace_check", sql`${table.marketplace} IN ('ozon', 'wb', 'avito', 'other', 'unknown')`),
  uniqueIndex("supplies_user_source_key_unique_idx").on(table.userId, table.sourceKey),
  uniqueIndex("supplies_user_ozon_supply_id_unique_idx").on(table.userId, table.ozonSupplyId),
]);

export const supplyLines = pgTable(
  "supply_lines",
  {
    id: id(),
    userId: userId(),
    supplyId: uuid("supply_id").notNull().references(() => supplies.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(),
    productSkuSnapshot: text("product_sku_snapshot").notNull().default(""),
    productTitleSnapshot: text("product_title_snapshot").notNull().default(""),
    purchaseUnitCostSnapshot: numeric("purchase_unit_cost_snapshot", { precision: 16, scale: 2 }),
    landedUnitCostSnapshot: numeric("landed_unit_cost_snapshot", { precision: 16, scale: 2 }),
    quantity: quantity("quantity"),
    sourceKey: text("source_key"),
  },
  (table) => [index("supply_lines_product_idx").on(table.userId, table.productId), uniqueIndex("supply_lines_user_source_key_unique_idx").on(table.userId, table.sourceKey)],
);

export const supplyCargoLabels = pgTable(
  "supply_cargo_labels",
  {
    id: id(),
    userId: userId(),
    supplyId: uuid("supply_id").notNull().references(() => supplies.id, { onDelete: "cascade" }),
    ozonSupplyId: text("ozon_supply_id").notNull(),
    cargoId: text("cargo_id").notNull(),
    cargoType: text("cargo_type").notNull().default(""),
    bundleId: text("bundle_id").notNull().default(""),
    labelPng: bytea("label_png"),
    labelFormatVersion: integer("label_format_version").notNull().default(0),
    labelError: text("label_error").notNull().default(""),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("supply_cargo_labels_supply_cargo_unique_idx").on(table.userId, table.supplyId, table.cargoId),
    index("supply_cargo_labels_supply_idx").on(table.userId, table.supplyId),
  ],
);

export const expenses = pgTable(
  "expenses",
  {
    id: id(),
    userId: userId(),
    spentAt: date("spent_at").notNull(),
    description: text("description").notNull(),
    amount: money("amount"),
    note: text("note").notNull().default(""),
    sourceKey: text("source_key"),
    createdAt: createdAt(),
  },
  (table) => [index("expenses_date_idx").on(table.userId, table.spentAt), uniqueIndex("expenses_user_source_key_unique_idx").on(table.userId, table.sourceKey)],
);

export const postings = pgTable(
  "ozon_postings",
  {
    id: id(),
    userId: userId(),
    externalId: text("external_id").notNull(),
    orderNumber: text("order_number").notNull().default(""),
    status: text("status").notNull().default("unknown"),
    orderDate: timestamp("order_date", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    marketplaceBuyoutAt: timestamp("marketplace_buyout_at", { withTimezone: true }),
    addedCostRatePercent: numeric("added_cost_rate_percent", { precision: 12, scale: 8 }),
    addedCostBreakdown: jsonb("added_cost_breakdown").$type<Record<string, unknown>>(),
    isMarketplaceBuyout: boolean("is_marketplace_buyout").notNull().default(false),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("ozon_postings_user_external_id_unique_idx").on(table.userId, table.externalId), index("ozon_postings_delivered_idx").on(table.userId, table.deliveredAt), index("ozon_postings_status_idx").on(table.userId, table.status)],
);

export const postingItems = pgTable(
  "ozon_posting_items",
  {
    id: id(),
    userId: userId(),
    postingId: uuid("posting_id").notNull().references(() => postings.id, { onDelete: "cascade" }),
    externalKey: text("external_key").notNull(),
    productId: uuid("product_id"),
    offerId: text("offer_id").notNull().default(""),
    ozonSku: text("ozon_sku").notNull().default(""),
    title: text("title").notNull().default("Без названия"),
    quantity: quantity("quantity"),
    price: money("price"),
    movementEnabled: boolean("movement_enabled").notNull().default(true),
    isMarketplaceBuyout: boolean("is_marketplace_buyout").notNull().default(false),
    marketplaceBuyoutAt: timestamp("marketplace_buyout_at", { withTimezone: true }),
    marketplaceBuyoutAmount: numeric("marketplace_buyout_amount", { precision: 16, scale: 2 }),
    sourceKey: text("source_key"),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [index("posting_items_posting_idx").on(table.userId, table.postingId), index("posting_items_product_idx").on(table.userId, table.productId), uniqueIndex("posting_items_user_source_key_unique_idx").on(table.userId, table.sourceKey)],
);

export const financeAccruals = pgTable(
  "ozon_finance_accruals",
  {
    id: id(),
    userId: userId(),
    externalKey: text("external_key").notNull(),
    accrualDate: date("accrual_date").notNull(),
    postingNumber: text("posting_number"),
    productId: uuid("product_id"),
    accrualId: text("accrual_id").notNull().default(""),
    accruedCategory: text("accrued_category").notNull().default("unknown"),
    typeId: text("type_id").notNull().default(""),
    amount: money("amount"),
    relatedSkus: jsonb("related_skus").$type<string[]>(),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    importedAt: createdAt(),
  },
  (table) => [uniqueIndex("finance_accruals_user_external_key_unique_idx").on(table.userId, table.externalKey), index("finance_accruals_posting_idx").on(table.userId, table.postingNumber), index("finance_accruals_date_idx").on(table.userId, table.accrualDate)],
);

export const ozonCompensationReports = pgTable("ozon_compensation_reports", {
  userId: userId(),
  reportMonth: text("report_month").notNull(),
  reportNumber: text("report_number").notNull().default(""),
  lines: jsonb("lines").$type<OzonCompensationReportLine[]>().notNull().default([]),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.reportMonth] })]);

export const ozonPayouts = pgTable(
  "ozon_payouts",
  {
    id: id(),
    userId: userId(),
    externalKey: text("external_key").notNull(),
    periodId: text("period_id").notNull(),
    periodBegin: date("period_begin").notNull(),
    periodEnd: date("period_end").notNull(),
    currencyCode: text("currency_code").notNull().default("RUB"),
    amount: money("amount"),
    excludedFromAccounting: boolean("excluded_from_accounting").notNull().default(false),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("ozon_payouts_user_external_key_unique_idx").on(table.userId, table.externalKey), index("ozon_payouts_period_idx").on(table.userId, table.periodId)],
);

export const returns = pgTable(
  "ozon_returns",
  {
    id: id(),
    userId: userId(),
    externalId: text("external_id").notNull(),
    postingNumber: text("posting_number"),
    externalKey: text("external_key").notNull(),
    productId: uuid("product_id"),
    offerId: text("offer_id").notNull().default(""),
    ozonSku: text("ozon_sku").notNull().default(""),
    quantity: quantity("quantity"),
    destination: returnDestinationEnum("destination").notNull().default("unknown"),
    status: text("status").notNull().default("unknown"),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    receivedBySellerAt: timestamp("received_by_seller_at", { withTimezone: true }),
    writtenOffAt: timestamp("written_off_at", { withTimezone: true }),
    availableAtOzon: timestamp("available_at_ozon", { withTimezone: true }),
    manualReconciliationFields: text("manual_reconciliation_fields").array().notNull().default(sql`ARRAY[]::text[]`),
    note: text("note").notNull().default(""),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("ozon_returns_user_external_id_unique_idx").on(table.userId, table.externalId), index("ozon_returns_posting_idx").on(table.userId, table.postingNumber), index("ozon_returns_product_idx").on(table.userId, table.productId)],
);

export const manualWriteoffs = pgTable("manual_writeoffs", {
  id: id(),
  userId: userId(),
  productId: uuid("product_id").notNull(),
  productSkuSnapshot: text("product_sku_snapshot").notNull().default(""),
  productTitleSnapshot: text("product_title_snapshot").notNull().default(""),
  writtenOffAt: date("written_off_at").notNull(),
  quantity: quantity("quantity"),
  note: text("note").notNull().default(""),
  sourceKey: text("source_key"),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("manual_writeoffs_user_source_key_unique_idx").on(table.userId, table.sourceKey)]);

export const ozonWriteoffs = pgTable(
  "ozon_writeoffs",
  {
    id: id(),
    userId: userId(),
    externalId: text("external_id").notNull(),
    productId: uuid("product_id"),
    externalKey: text("external_key").notNull(),
    offerId: text("offer_id").notNull().default(""),
    ozonSku: text("ozon_sku").notNull().default(""),
    quantity: quantity("quantity"),
    compensationStatus: text("compensation_status").notNull().default("unknown"),
    compensationAmount: money("compensation_amount"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("ozon_writeoffs_user_external_id_unique_idx").on(table.userId, table.externalId), index("ozon_writeoffs_product_idx").on(table.userId, table.productId)],
);

export const stocktakes = pgTable("stocktakes", {
  id: id(),
  userId: userId(),
  warehouse: warehouseEnum("warehouse").notNull(),
  countedAt: date("counted_at").notNull(),
  note: text("note").notNull().default(""),
  sourceKey: text("source_key"),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("stocktakes_user_source_key_unique_idx").on(table.userId, table.sourceKey), uniqueIndex("stocktakes_warehouse_counted_at_uq").on(table.userId, table.warehouse, table.countedAt)]);

export const stocktakeLines = pgTable(
  "stocktake_lines",
  {
    id: id(),
    userId: userId(),
    stocktakeId: uuid("stocktake_id").notNull().references(() => stocktakes.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(),
    productSkuSnapshot: text("product_sku_snapshot").notNull().default(""),
    productTitleSnapshot: text("product_title_snapshot").notNull().default(""),
    expectedQuantity: quantity("expected_quantity"),
    actualQuantity: quantity("actual_quantity"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note").notNull().default(""),
    sourceKey: text("source_key"),
    createdAt: createdAt(),
  },
  (table) => [index("stocktake_lines_stocktake_idx").on(table.userId, table.stocktakeId), uniqueIndex("stocktake_lines_user_source_key_unique_idx").on(table.userId, table.sourceKey), uniqueIndex("stocktake_lines_product_uq").on(table.userId, table.stocktakeId, table.productId)],
);

export const stockAdjustments = pgTable("stock_adjustments", {
  id: id(),
  userId: userId(),
  stocktakeLineId: uuid("stocktake_line_id").notNull().references(() => stocktakeLines.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull(),
  productSkuSnapshot: text("product_sku_snapshot").notNull().default(""),
  productTitleSnapshot: text("product_title_snapshot").notNull().default(""),
  warehouse: warehouseEnum("warehouse").notNull(),
  actualQuantity: quantity("actual_quantity"),
  adjustedAt: date("adjusted_at").notNull(),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("stock_adjustments_user_stocktake_line_unique_idx").on(table.userId, table.stocktakeLineId)]);

export const appSettings = pgTable(
  "app_settings",
  {
    id: serial("id").primaryKey(),
    userId: userId(),
    ozonClientId: text("ozon_client_id"),
    ozonApiKeyEncrypted: text("ozon_api_key_encrypted"),
    accountingStartDate: date("accounting_start_date").notNull().default("2025-10-20"),
    ozonSharedExpenseHistoryStartDate: date("ozon_shared_expense_history_start_date"),
    ozonPayoutHistoryStartDate: date("ozon_payout_history_start_date"),
    ozonCompensationReportHistoryStartDate: date("ozon_compensation_report_history_start_date"),
    marketplaceBuyoutReportStartDate: date("marketplace_buyout_report_start_date"),
    syncIntervalHours: integer("sync_interval_hours").notNull().default(24),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("app_settings_user_unique_idx").on(table.userId)],
);

export const syncJobs = pgTable(
  "sync_jobs",
  {
    id: id(),
    userId: userId(),
    status: syncJobStatusEnum("status").notNull().default("queued"),
    kind: text("kind").notNull().default("full"),
    requestedAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    error: text("error"),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [index("sync_jobs_status_requested_idx").on(table.userId, table.status, table.requestedAt)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    userId: userId(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    source: text("source").notNull(),
    entityType: text("entity_type").notNull(),
    action: text("action").notNull(),
    recordKey: text("record_key").notNull().default(""),
    transactionId: text("transaction_id").notNull(),
    beforeData: jsonb("before_data").$type<Record<string, unknown>>(),
    afterData: jsonb("after_data").$type<Record<string, unknown>>(),
    changedFields: jsonb("changed_fields").$type<Record<string, { before: unknown; after: unknown }>>().notNull().default({}),
  },
  (table) => [
    index("audit_events_occurred_at_idx").on(table.userId, table.occurredAt),
    index("audit_events_entity_record_idx").on(table.userId, table.entityType, table.recordKey),
    index("audit_events_source_idx").on(table.userId, table.source),
  ],
);

export const importBatches = pgTable("import_batches", {
  id: id(),
  userId: userId(),
  fileName: text("file_name").notNull(),
  contentHash: text("content_hash").notNull().default(""),
  status: text("status").notNull().default("preview"),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
});

export const importRows = pgTable(
  "import_rows",
  {
    id: id(),
    userId: userId(),
    batchId: uuid("batch_id").notNull().references(() => importBatches.id, { onDelete: "cascade" }),
    sheetName: text("sheet_name").notNull(),
    rowNumber: integer("row_number").notNull(),
    rowType: text("row_type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    issue: text("issue"),
    createdAt: createdAt(),
  },
  (table) => [index("import_rows_batch_idx").on(table.batchId)],
);

export const scenarioCalculations = pgTable(
  "scenario_calculations",
  {
    id: id(),
    userId: userId(),
    comment: text("comment").notNull(),
    inputs: jsonb("inputs").$type<Record<string, number>>().notNull(),
    profit: numeric("profit", { precision: 16, scale: 2 }).notNull(),
    profitShare: numeric("profit_share", { precision: 12, scale: 4 }).notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("scenario_calculations_created_idx").on(table.createdAt)],
);
