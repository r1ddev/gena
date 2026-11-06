CREATE TABLE "user_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"login" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "users" ("id", "login", "password_hash") VALUES ('00000000-0000-4000-8000-000000000001', '__legacy_owner__', '!disabled-placeholder-account');--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_source_key_unique";--> statement-breakpoint
ALTER TABLE "external_items" DROP CONSTRAINT "external_items_external_key_unique";--> statement-breakpoint
ALTER TABLE "ozon_finance_accruals" DROP CONSTRAINT "ozon_finance_accruals_external_key_unique";--> statement-breakpoint
ALTER TABLE "manual_writeoffs" DROP CONSTRAINT "manual_writeoffs_source_key_unique";--> statement-breakpoint
ALTER TABLE "ozon_payouts" DROP CONSTRAINT "ozon_payouts_external_key_unique";--> statement-breakpoint
ALTER TABLE "ozon_writeoffs" DROP CONSTRAINT "ozon_writeoffs_external_id_unique";--> statement-breakpoint
ALTER TABLE "ozon_posting_items" DROP CONSTRAINT "ozon_posting_items_source_key_unique";--> statement-breakpoint
ALTER TABLE "ozon_postings" DROP CONSTRAINT "ozon_postings_external_id_unique";--> statement-breakpoint
ALTER TABLE "purchase_receipts" DROP CONSTRAINT "purchase_receipts_source_key_unique";--> statement-breakpoint
ALTER TABLE "purchases" DROP CONSTRAINT "purchases_source_key_unique";--> statement-breakpoint
ALTER TABLE "ozon_returns" DROP CONSTRAINT "ozon_returns_external_id_unique";--> statement-breakpoint
ALTER TABLE "stock_adjustments" DROP CONSTRAINT "stock_adjustments_stocktake_line_id_unique";--> statement-breakpoint
ALTER TABLE "stocktake_lines" DROP CONSTRAINT "stocktake_lines_source_key_unique";--> statement-breakpoint
ALTER TABLE "stocktakes" DROP CONSTRAINT "stocktakes_source_key_unique";--> statement-breakpoint
ALTER TABLE "supplies" DROP CONSTRAINT "supplies_source_key_unique";--> statement-breakpoint
ALTER TABLE "supply_lines" DROP CONSTRAINT "supply_lines_source_key_unique";--> statement-breakpoint
ALTER TABLE "app_settings" DROP CONSTRAINT "app_settings_singleton_check";--> statement-breakpoint
DROP INDEX "external_items_disposition_idx";--> statement-breakpoint
DROP INDEX "product_links_product_unique_idx";--> statement-breakpoint
DROP INDEX "product_links_offer_id_unique_idx";--> statement-breakpoint
DROP INDEX "product_links_ozon_sku_unique_idx";--> statement-breakpoint
DROP INDEX "products_sku_unique";--> statement-breakpoint
DROP INDEX "supplies_ozon_supply_id_unique_idx";--> statement-breakpoint
DROP INDEX "audit_events_occurred_at_idx";--> statement-breakpoint
DROP INDEX "audit_events_entity_record_idx";--> statement-breakpoint
DROP INDEX "audit_events_source_idx";--> statement-breakpoint
DROP INDEX "expenses_date_idx";--> statement-breakpoint
DROP INDEX "finance_accruals_posting_idx";--> statement-breakpoint
DROP INDEX "finance_accruals_date_idx";--> statement-breakpoint
DROP INDEX "ozon_payouts_period_idx";--> statement-breakpoint
DROP INDEX "ozon_writeoffs_product_idx";--> statement-breakpoint
DROP INDEX "posting_items_posting_idx";--> statement-breakpoint
DROP INDEX "posting_items_product_idx";--> statement-breakpoint
DROP INDEX "ozon_postings_delivered_idx";--> statement-breakpoint
DROP INDEX "ozon_postings_status_idx";--> statement-breakpoint
DROP INDEX "purchase_receipts_purchase_idx";--> statement-breakpoint
DROP INDEX "purchases_product_date_idx";--> statement-breakpoint
DROP INDEX "ozon_returns_posting_idx";--> statement-breakpoint
DROP INDEX "ozon_returns_product_idx";--> statement-breakpoint
DROP INDEX "stocktake_lines_stocktake_idx";--> statement-breakpoint
DROP INDEX "stocktake_lines_product_uq";--> statement-breakpoint
DROP INDEX "stocktakes_warehouse_counted_at_uq";--> statement-breakpoint
DROP INDEX "supply_cargo_labels_supply_cargo_unique_idx";--> statement-breakpoint
DROP INDEX "supply_cargo_labels_supply_idx";--> statement-breakpoint
DROP INDEX "supply_lines_product_idx";--> statement-breakpoint
DROP INDEX "sync_jobs_status_requested_idx";--> statement-breakpoint
ALTER TABLE "ozon_compensation_reports" DROP CONSTRAINT "ozon_compensation_reports_pkey";--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
CREATE SEQUENCE "app_settings_id_seq" OWNED BY "app_settings"."id";--> statement-breakpoint
SELECT setval('app_settings_id_seq', GREATEST(COALESCE((SELECT MAX("id") FROM "app_settings"), 0), 1));--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "id" SET DEFAULT nextval('app_settings_id_seq');--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "external_items" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "external_items" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ozon_finance_accruals" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "ozon_finance_accruals" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batches" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "import_rows" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_rows" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "manual_writeoffs" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "manual_writeoffs" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ozon_compensation_reports" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "ozon_compensation_reports" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ozon_compensation_reports" ADD CONSTRAINT "ozon_compensation_reports_user_id_report_month_pk" PRIMARY KEY("user_id","report_month");--> statement-breakpoint
ALTER TABLE "ozon_payouts" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "ozon_payouts" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ozon_writeoffs" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "ozon_writeoffs" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ozon_posting_items" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "ozon_posting_items" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ozon_postings" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "ozon_postings" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_images" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "product_links" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_links" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ozon_returns" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "ozon_returns" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "scenario_calculations" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "scenario_calculations" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "stocktake_lines" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "stocktake_lines" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "stocktakes" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "supplies" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplies" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "supply_cargo_labels" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "supply_cargo_labels" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "supply_lines" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "supply_lines" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD COLUMN "user_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_jobs" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_sessions_user_idx" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_sessions_expiry_idx" ON "user_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_login_lower_unique_idx" ON "users" USING btree (lower("login"));--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_items" ADD CONSTRAINT "external_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_finance_accruals" ADD CONSTRAINT "ozon_finance_accruals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_writeoffs" ADD CONSTRAINT "manual_writeoffs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_compensation_reports" ADD CONSTRAINT "ozon_compensation_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_payouts" ADD CONSTRAINT "ozon_payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_writeoffs" ADD CONSTRAINT "ozon_writeoffs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_posting_items" ADD CONSTRAINT "ozon_posting_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_postings" ADD CONSTRAINT "ozon_postings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_links" ADD CONSTRAINT "product_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ozon_returns" ADD CONSTRAINT "ozon_returns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_calculations" ADD CONSTRAINT "scenario_calculations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplies" ADD CONSTRAINT "supplies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_cargo_labels" ADD CONSTRAINT "supply_cargo_labels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_lines" ADD CONSTRAINT "supply_lines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_settings_user_unique_idx" ON "app_settings" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_user_source_key_unique_idx" ON "expenses" USING btree ("user_id","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "external_items_user_external_key_unique_idx" ON "external_items" USING btree ("user_id","external_key");--> statement-breakpoint
CREATE INDEX "external_items_user_disposition_idx" ON "external_items" USING btree ("user_id","disposition");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_accruals_user_external_key_unique_idx" ON "ozon_finance_accruals" USING btree ("user_id","external_key");--> statement-breakpoint
CREATE UNIQUE INDEX "manual_writeoffs_user_source_key_unique_idx" ON "manual_writeoffs" USING btree ("user_id","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ozon_payouts_user_external_key_unique_idx" ON "ozon_payouts" USING btree ("user_id","external_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ozon_writeoffs_user_external_id_unique_idx" ON "ozon_writeoffs" USING btree ("user_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "posting_items_user_source_key_unique_idx" ON "ozon_posting_items" USING btree ("user_id","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ozon_postings_user_external_id_unique_idx" ON "ozon_postings" USING btree ("user_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_links_user_product_unique_idx" ON "product_links" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_links_user_offer_id_unique_idx" ON "product_links" USING btree ("user_id","offer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_links_user_ozon_sku_unique_idx" ON "product_links" USING btree ("user_id","ozon_sku");--> statement-breakpoint
CREATE UNIQUE INDEX "products_user_sku_unique" ON "products" USING btree ("user_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_receipts_user_source_key_unique_idx" ON "purchase_receipts" USING btree ("user_id","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_user_source_key_unique_idx" ON "purchases" USING btree ("user_id","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ozon_returns_user_external_id_unique_idx" ON "ozon_returns" USING btree ("user_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_adjustments_user_stocktake_line_unique_idx" ON "stock_adjustments" USING btree ("user_id","stocktake_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stocktake_lines_user_source_key_unique_idx" ON "stocktake_lines" USING btree ("user_id","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "stocktakes_user_source_key_unique_idx" ON "stocktakes" USING btree ("user_id","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "supplies_user_source_key_unique_idx" ON "supplies" USING btree ("user_id","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "supplies_user_ozon_supply_id_unique_idx" ON "supplies" USING btree ("user_id","ozon_supply_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supply_lines_user_source_key_unique_idx" ON "supply_lines" USING btree ("user_id","source_key");--> statement-breakpoint
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_record_idx" ON "audit_events" USING btree ("user_id","entity_type","record_key");--> statement-breakpoint
CREATE INDEX "audit_events_source_idx" ON "audit_events" USING btree ("user_id","source");--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("user_id","spent_at");--> statement-breakpoint
CREATE INDEX "finance_accruals_posting_idx" ON "ozon_finance_accruals" USING btree ("user_id","posting_number");--> statement-breakpoint
CREATE INDEX "finance_accruals_date_idx" ON "ozon_finance_accruals" USING btree ("user_id","accrual_date");--> statement-breakpoint
CREATE INDEX "ozon_payouts_period_idx" ON "ozon_payouts" USING btree ("user_id","period_id");--> statement-breakpoint
CREATE INDEX "ozon_writeoffs_product_idx" ON "ozon_writeoffs" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE INDEX "posting_items_posting_idx" ON "ozon_posting_items" USING btree ("user_id","posting_id");--> statement-breakpoint
CREATE INDEX "posting_items_product_idx" ON "ozon_posting_items" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE INDEX "ozon_postings_delivered_idx" ON "ozon_postings" USING btree ("user_id","delivered_at");--> statement-breakpoint
CREATE INDEX "ozon_postings_status_idx" ON "ozon_postings" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "purchase_receipts_purchase_idx" ON "purchase_receipts" USING btree ("user_id","purchase_id");--> statement-breakpoint
CREATE INDEX "purchases_product_date_idx" ON "purchases" USING btree ("user_id","product_id","purchased_at");--> statement-breakpoint
CREATE INDEX "ozon_returns_posting_idx" ON "ozon_returns" USING btree ("user_id","posting_number");--> statement-breakpoint
CREATE INDEX "ozon_returns_product_idx" ON "ozon_returns" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE INDEX "stocktake_lines_stocktake_idx" ON "stocktake_lines" USING btree ("user_id","stocktake_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stocktake_lines_product_uq" ON "stocktake_lines" USING btree ("user_id","stocktake_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stocktakes_warehouse_counted_at_uq" ON "stocktakes" USING btree ("user_id","warehouse","counted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "supply_cargo_labels_supply_cargo_unique_idx" ON "supply_cargo_labels" USING btree ("user_id","supply_id","cargo_id");--> statement-breakpoint
CREATE INDEX "supply_cargo_labels_supply_idx" ON "supply_cargo_labels" USING btree ("user_id","supply_id");--> statement-breakpoint
CREATE INDEX "supply_lines_product_idx" ON "supply_lines" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE INDEX "sync_jobs_status_requested_idx" ON "sync_jobs" USING btree ("user_id","status","created_at");
