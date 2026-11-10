CREATE TYPE "public"."external_disposition" AS ENUM('pending', 'mapped', 'created', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."return_destination" AS ENUM('seller', 'ozon', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."sync_job_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."warehouse" AS ENUM('seller', 'ozon');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"ozon_client_id" text,
	"ozon_api_key_encrypted" text,
	"sync_interval_hours" integer DEFAULT 24 NOT NULL,
	"last_sync_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_singleton_check" CHECK ("app_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spent_at" date NOT NULL,
	"category" text NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"source_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
CREATE TABLE "external_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_key" text NOT NULL,
	"offer_id" text DEFAULT '' NOT NULL,
	"ozon_sku" text DEFAULT '' NOT NULL,
	"title" text DEFAULT 'Без названия' NOT NULL,
	"disposition" "external_disposition" DEFAULT 'pending' NOT NULL,
	"product_id" uuid,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_items_external_key_unique" UNIQUE("external_key")
);
--> statement-breakpoint
CREATE TABLE "ozon_finance_accruals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_key" text NOT NULL,
	"accrual_date" date NOT NULL,
	"posting_number" text,
	"product_id" uuid,
	"accrual_id" text DEFAULT '' NOT NULL,
	"accrued_category" text DEFAULT 'unknown' NOT NULL,
	"type_id" text DEFAULT '' NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ozon_finance_accruals_external_key_unique" UNIQUE("external_key")
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" text NOT NULL,
	"status" text DEFAULT 'preview' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"sheet_name" text NOT NULL,
	"row_number" integer NOT NULL,
	"row_type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"issue" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_writeoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"written_off_at" date NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"source_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_writeoffs_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
CREATE TABLE "ozon_writeoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"product_id" uuid,
	"external_key" text NOT NULL,
	"offer_id" text DEFAULT '' NOT NULL,
	"ozon_sku" text DEFAULT '' NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"compensation_status" text DEFAULT 'unknown' NOT NULL,
	"compensation_amount" numeric(16, 2) NOT NULL,
	"occurred_at" timestamp with time zone,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ozon_writeoffs_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "ozon_posting_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"posting_id" uuid NOT NULL,
	"external_key" text NOT NULL,
	"product_id" uuid,
	"offer_id" text DEFAULT '' NOT NULL,
	"ozon_sku" text DEFAULT '' NOT NULL,
	"title" text DEFAULT 'Без названия' NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"price" numeric(16, 2) NOT NULL,
	"movement_enabled" boolean DEFAULT true NOT NULL,
	"source_key" text,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "ozon_posting_items_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
CREATE TABLE "ozon_postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"order_number" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"order_date" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"is_marketplace_buyout" boolean DEFAULT false NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ozon_postings_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "product_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"offer_id" text NOT NULL,
	"ozon_sku" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"title" text NOT NULL,
	"category" text DEFAULT 'Без категории' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "purchase_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"received_at" date NOT NULL,
	"received_quantity" numeric(14, 3) NOT NULL,
	"unit_cost" numeric(16, 2) NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"source_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_receipts_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"purchased_at" date NOT NULL,
	"ordered_quantity" numeric(14, 3) NOT NULL,
	"amount_paid" numeric(16, 2) NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"source_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchases_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
CREATE TABLE "ozon_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"posting_number" text,
	"external_key" text NOT NULL,
	"product_id" uuid,
	"offer_id" text DEFAULT '' NOT NULL,
	"ozon_sku" text DEFAULT '' NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"destination" "return_destination" DEFAULT 'unknown' NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"returned_at" timestamp with time zone,
	"received_by_seller_at" timestamp with time zone,
	"available_at_ozon" timestamp with time zone,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ozon_returns_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "stock_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stocktake_line_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse" "warehouse" NOT NULL,
	"actual_quantity" numeric(14, 3) NOT NULL,
	"adjusted_at" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_adjustments_stocktake_line_id_unique" UNIQUE("stocktake_line_id")
);
--> statement-breakpoint
CREATE TABLE "stocktake_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stocktake_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"expected_quantity" numeric(14, 3) NOT NULL,
	"actual_quantity" numeric(14, 3) NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_note" text DEFAULT '' NOT NULL,
	"source_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stocktake_lines_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
CREATE TABLE "stocktakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse" "warehouse" NOT NULL,
	"counted_at" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"source_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stocktakes_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
CREATE TABLE "supplies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplied_at" date NOT NULL,
	"shipping_cost" numeric(16, 2) NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"source_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplies_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
CREATE TABLE "supply_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supply_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"source_key" text,
	CONSTRAINT "supply_lines_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "sync_job_status" DEFAULT 'queued' NOT NULL,
	"kind" text DEFAULT 'full' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"error" text,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_items" ADD CONSTRAINT "external_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_finance_accruals" ADD CONSTRAINT "ozon_finance_accruals_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_writeoffs" ADD CONSTRAINT "manual_writeoffs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_writeoffs" ADD CONSTRAINT "ozon_writeoffs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_posting_items" ADD CONSTRAINT "ozon_posting_items_posting_id_ozon_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."ozon_postings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_posting_items" ADD CONSTRAINT "ozon_posting_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_links" ADD CONSTRAINT "product_links_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_returns" ADD CONSTRAINT "ozon_returns_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_stocktake_line_id_stocktake_lines_id_fk" FOREIGN KEY ("stocktake_line_id") REFERENCES "public"."stocktake_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_stocktake_id_stocktakes_id_fk" FOREIGN KEY ("stocktake_id") REFERENCES "public"."stocktakes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_lines" ADD CONSTRAINT "supply_lines_supply_id_supplies_id_fk" FOREIGN KEY ("supply_id") REFERENCES "public"."supplies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_lines" ADD CONSTRAINT "supply_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("spent_at");--> statement-breakpoint
CREATE INDEX "external_items_disposition_idx" ON "external_items" USING btree ("disposition");--> statement-breakpoint
CREATE INDEX "finance_accruals_posting_idx" ON "ozon_finance_accruals" USING btree ("posting_number");--> statement-breakpoint
CREATE INDEX "finance_accruals_date_idx" ON "ozon_finance_accruals" USING btree ("accrual_date");--> statement-breakpoint
CREATE INDEX "import_rows_batch_idx" ON "import_rows" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "ozon_writeoffs_product_idx" ON "ozon_writeoffs" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "posting_items_posting_idx" ON "ozon_posting_items" USING btree ("posting_id");--> statement-breakpoint
CREATE INDEX "posting_items_product_idx" ON "ozon_posting_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "ozon_postings_delivered_idx" ON "ozon_postings" USING btree ("delivered_at");--> statement-breakpoint
CREATE INDEX "ozon_postings_status_idx" ON "ozon_postings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "product_links_external_idx" ON "product_links" USING btree ("offer_id","ozon_sku");--> statement-breakpoint
CREATE INDEX "product_links_product_idx" ON "product_links" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "products_archived_title_idx" ON "products" USING btree ("archived","title");--> statement-breakpoint
CREATE INDEX "purchase_receipts_purchase_idx" ON "purchase_receipts" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "purchases_product_date_idx" ON "purchases" USING btree ("product_id","purchased_at");--> statement-breakpoint
CREATE INDEX "ozon_returns_posting_idx" ON "ozon_returns" USING btree ("posting_number");--> statement-breakpoint
CREATE INDEX "ozon_returns_product_idx" ON "ozon_returns" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "stocktake_lines_stocktake_idx" ON "stocktake_lines" USING btree ("stocktake_id");--> statement-breakpoint
CREATE INDEX "supply_lines_product_idx" ON "supply_lines" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sync_jobs_status_requested_idx" ON "sync_jobs" USING btree ("status","created_at");