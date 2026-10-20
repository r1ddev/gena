import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const id = () => uuid("id").defaultRandom().primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const money = (name: string) => numeric(name, { precision: 16, scale: 2 }).notNull();
const quantity = (name: string) => numeric(name, { precision: 14, scale: 3 }).notNull();

export const dispositionEnum = pgEnum("external_disposition", ["pending", "mapped", "created", "ignored"]);
export const syncJobStatusEnum = pgEnum("sync_job_status", ["queued", "running", "completed", "failed"]);
export const returnDestinationEnum = pgEnum("return_destination", ["seller", "ozon", "unknown"]);
export const warehouseEnum = pgEnum("warehouse", ["seller", "ozon"]);

export const products = pgTable(
  "products",
  {
    id: id(),
    sku: text("sku").notNull().unique(),
    title: text("title").notNull(),
    category: text("category").notNull().default("Без категории"),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("products_archived_title_idx").on(table.archived, table.title)],
);

export const productLinks = pgTable(
  "product_links",
  {
    id: id(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    offerId: text("offer_id").notNull(),
    ozonSku: text("ozon_sku"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("product_links_external_idx").on(table.offerId, table.ozonSku),
    index("product_links_product_idx").on(table.productId),
  ],
);

export const externalItems = pgTable(
  "external_items",
  {
    id: id(),
    externalKey: text("external_key").notNull().unique(),
    offerId: text("offer_id").notNull().default(""),
    ozonSku: text("ozon_sku").notNull().default(""),
    title: text("title").notNull().default("Без названия"),
    disposition: dispositionEnum("disposition").notNull().default("pending"),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    firstSeenAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("external_items_disposition_idx").on(table.disposition)],
);

export const purchases = pgTable(
  "purchases",
  {
    id: id(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
    purchasedAt: date("purchased_at").notNull(),
    orderedQuantity: quantity("ordered_quantity"),
    amountPaid: money("amount_paid"),
    note: text("note").notNull().default(""),
    sourceKey: text("source_key").unique(),
    createdAt: createdAt(),
  },
  (table) => [index("purchases_product_date_idx").on(table.productId, table.purchasedAt)],
);

export const purchaseReceipts = pgTable(
  "purchase_receipts",
  {
    id: id(),
    purchaseId: uuid("purchase_id").notNull().references(() => purchases.id, { onDelete: "cascade" }),
    receivedAt: date("received_at").notNull(),
    receivedQuantity: quantity("received_quantity"),
    unitCost: money("unit_cost"),
    note: text("note").notNull().default(""),
    sourceKey: text("source_key").unique(),
    createdAt: createdAt(),
  },
  (table) => [index("purchase_receipts_purchase_idx").on(table.purchaseId)],
);

export const supplies = pgTable("supplies", {
  id: id(),
  suppliedAt: date("supplied_at").notNull(),
  shippingCost: money("shipping_cost"),
  note: text("note").notNull().default(""),
  sourceKey: text("source_key").unique(),
  createdAt: createdAt(),
});

export const supplyLines = pgTable(
  "supply_lines",
  {
    id: id(),
    supplyId: uuid("supply_id").notNull().references(() => supplies.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
    quantity: quantity("quantity"),
    sourceKey: text("source_key").unique(),
  },
  (table) => [index("supply_lines_product_idx").on(table.productId)],
);

export const expenses = pgTable(
  "expenses",
  {
    id: id(),
    spentAt: date("spent_at").notNull(),
    category: text("category").notNull(),
    amount: money("amount"),
    note: text("note").notNull().default(""),
    sourceKey: text("source_key").unique(),
    createdAt: createdAt(),
  },
  (table) => [index("expenses_date_idx").on(table.spentAt)],
);

export const postings = pgTable(
  "ozon_postings",
  {
    id: id(),
    externalId: text("external_id").notNull().unique(),
    orderNumber: text("order_number").notNull().default(""),
    status: text("status").notNull().default("unknown"),
    orderDate: timestamp("order_date", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    marketplaceBuyoutAt: timestamp("marketplace_buyout_at", { withTimezone: true }),
    isMarketplaceBuyout: boolean("is_marketplace_buyout").notNull().default(false),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("ozon_postings_delivered_idx").on(table.deliveredAt), index("ozon_postings_status_idx").on(table.status)],
);

export const postingItems = pgTable(
  "ozon_posting_items",
  {
    id: id(),
    postingId: uuid("posting_id").notNull().references(() => postings.id, { onDelete: "cascade" }),
    externalKey: text("external_key").notNull(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    offerId: text("offer_id").notNull().default(""),
    ozonSku: text("ozon_sku").notNull().default(""),
    title: text("title").notNull().default("Без названия"),
    quantity: quantity("quantity"),
    price: money("price"),
    movementEnabled: boolean("movement_enabled").notNull().default(true),
    sourceKey: text("source_key").unique(),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [index("posting_items_posting_idx").on(table.postingId), index("posting_items_product_idx").on(table.productId)],
);

export const financeAccruals = pgTable(
  "ozon_finance_accruals",
  {
    id: id(),
    externalKey: text("external_key").notNull().unique(),
    accrualDate: date("accrual_date").notNull(),
    postingNumber: text("posting_number"),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    accrualId: text("accrual_id").notNull().default(""),
    accruedCategory: text("accrued_category").notNull().default("unknown"),
    typeId: text("type_id").notNull().default(""),
    amount: money("amount"),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    importedAt: createdAt(),
  },
  (table) => [index("finance_accruals_posting_idx").on(table.postingNumber), index("finance_accruals_date_idx").on(table.accrualDate)],
);

export const returns = pgTable(
  "ozon_returns",
  {
    id: id(),
    externalId: text("external_id").notNull().unique(),
    postingNumber: text("posting_number"),
    externalKey: text("external_key").notNull(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    offerId: text("offer_id").notNull().default(""),
    ozonSku: text("ozon_sku").notNull().default(""),
    quantity: quantity("quantity"),
    destination: returnDestinationEnum("destination").notNull().default("unknown"),
    status: text("status").notNull().default("unknown"),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    receivedBySellerAt: timestamp("received_by_seller_at", { withTimezone: true }),
    availableAtOzon: timestamp("available_at_ozon", { withTimezone: true }),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("ozon_returns_posting_idx").on(table.postingNumber), index("ozon_returns_product_idx").on(table.productId)],
);

export const manualWriteoffs = pgTable("manual_writeoffs", {
  id: id(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  writtenOffAt: date("written_off_at").notNull(),
  quantity: quantity("quantity"),
  note: text("note").notNull().default(""),
  sourceKey: text("source_key").unique(),
  createdAt: createdAt(),
});

export const ozonWriteoffs = pgTable(
  "ozon_writeoffs",
  {
    id: id(),
    externalId: text("external_id").notNull().unique(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
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
  (table) => [index("ozon_writeoffs_product_idx").on(table.productId)],
);

export const stocktakes = pgTable("stocktakes", {
  id: id(),
  warehouse: warehouseEnum("warehouse").notNull(),
  countedAt: date("counted_at").notNull(),
  note: text("note").notNull().default(""),
  sourceKey: text("source_key").unique(),
  createdAt: createdAt(),
});

export const stocktakeLines = pgTable(
  "stocktake_lines",
  {
    id: id(),
    stocktakeId: uuid("stocktake_id").notNull().references(() => stocktakes.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
    expectedQuantity: quantity("expected_quantity"),
    actualQuantity: quantity("actual_quantity"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note").notNull().default(""),
    sourceKey: text("source_key").unique(),
    createdAt: createdAt(),
  },
  (table) => [index("stocktake_lines_stocktake_idx").on(table.stocktakeId)],
);

export const stockAdjustments = pgTable("stock_adjustments", {
  id: id(),
  stocktakeLineId: uuid("stocktake_line_id").notNull().unique().references(() => stocktakeLines.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  warehouse: warehouseEnum("warehouse").notNull(),
  actualQuantity: quantity("actual_quantity"),
  adjustedAt: date("adjusted_at").notNull(),
  createdAt: createdAt(),
});

export const appSettings = pgTable(
  "app_settings",
  {
    id: integer("id").primaryKey().default(1),
    ozonClientId: text("ozon_client_id"),
    ozonApiKeyEncrypted: text("ozon_api_key_encrypted"),
    syncIntervalHours: integer("sync_interval_hours").notNull().default(24),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [check("app_settings_singleton_check", sql`${table.id} = 1`)],
);

export const syncJobs = pgTable(
  "sync_jobs",
  {
    id: id(),
    status: syncJobStatusEnum("status").notNull().default("queued"),
    kind: text("kind").notNull().default("full"),
    requestedAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    error: text("error"),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [index("sync_jobs_status_requested_idx").on(table.status, table.requestedAt)],
);

export const importBatches = pgTable("import_batches", {
  id: id(),
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
