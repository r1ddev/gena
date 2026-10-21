ALTER TABLE "ozon_finance_accruals" DROP CONSTRAINT "ozon_finance_accruals_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "manual_writeoffs" DROP CONSTRAINT "manual_writeoffs_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "ozon_writeoffs" DROP CONSTRAINT "ozon_writeoffs_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "ozon_posting_items" DROP CONSTRAINT "ozon_posting_items_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" DROP CONSTRAINT "purchase_receipt_lines_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "purchases" DROP CONSTRAINT "purchases_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "ozon_returns" DROP CONSTRAINT "ozon_returns_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_adjustments" DROP CONSTRAINT "stock_adjustments_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "stocktake_lines" DROP CONSTRAINT "stocktake_lines_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "supply_lines" DROP CONSTRAINT "supply_lines_product_id_products_id_fk";
--> statement-breakpoint
DROP INDEX "products_sku_active_unique_idx";--> statement-breakpoint
ALTER TABLE "manual_writeoffs" ADD COLUMN "product_sku_snapshot" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "manual_writeoffs" ADD COLUMN "product_title_snapshot" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD COLUMN "product_sku_snapshot" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD COLUMN "product_title_snapshot" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "product_sku_snapshot" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "product_title_snapshot" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD COLUMN "product_sku_snapshot" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD COLUMN "product_title_snapshot" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "stocktake_lines" ADD COLUMN "product_sku_snapshot" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "stocktake_lines" ADD COLUMN "product_title_snapshot" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "supply_lines" ADD COLUMN "product_sku_snapshot" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "supply_lines" ADD COLUMN "product_title_snapshot" text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE "purchases" AS history
SET "product_sku_snapshot" = COALESCE(NULLIF(link."offer_id", ''), NULLIF(product."reassignment_offer_id", ''), product."sku", ''),
    "product_title_snapshot" = product."title"
FROM "products" AS product
LEFT JOIN "product_links" AS link ON link."product_id" = product."id"
WHERE history."product_id" = product."id";--> statement-breakpoint
UPDATE "purchase_receipt_lines" AS history
SET "product_sku_snapshot" = COALESCE(NULLIF(link."offer_id", ''), NULLIF(product."reassignment_offer_id", ''), product."sku", ''),
    "product_title_snapshot" = product."title"
FROM "products" AS product
LEFT JOIN "product_links" AS link ON link."product_id" = product."id"
WHERE history."product_id" = product."id";--> statement-breakpoint
UPDATE "supply_lines" AS history
SET "product_sku_snapshot" = COALESCE(NULLIF(link."offer_id", ''), NULLIF(product."reassignment_offer_id", ''), product."sku", ''),
    "product_title_snapshot" = product."title"
FROM "products" AS product
LEFT JOIN "product_links" AS link ON link."product_id" = product."id"
WHERE history."product_id" = product."id";--> statement-breakpoint
UPDATE "manual_writeoffs" AS history
SET "product_sku_snapshot" = COALESCE(NULLIF(link."offer_id", ''), NULLIF(product."reassignment_offer_id", ''), product."sku", ''),
    "product_title_snapshot" = product."title"
FROM "products" AS product
LEFT JOIN "product_links" AS link ON link."product_id" = product."id"
WHERE history."product_id" = product."id";--> statement-breakpoint
UPDATE "stocktake_lines" AS history
SET "product_sku_snapshot" = COALESCE(NULLIF(link."offer_id", ''), NULLIF(product."reassignment_offer_id", ''), product."sku", ''),
    "product_title_snapshot" = product."title"
FROM "products" AS product
LEFT JOIN "product_links" AS link ON link."product_id" = product."id"
WHERE history."product_id" = product."id";--> statement-breakpoint
UPDATE "stock_adjustments" AS history
SET "product_sku_snapshot" = COALESCE(NULLIF(link."offer_id", ''), NULLIF(product."reassignment_offer_id", ''), product."sku", ''),
    "product_title_snapshot" = product."title"
FROM "products" AS product
LEFT JOIN "product_links" AS link ON link."product_id" = product."id"
WHERE history."product_id" = product."id";--> statement-breakpoint
UPDATE "external_items"
SET "disposition" = 'mapped'
WHERE "product_id" IN (SELECT "id" FROM "products" WHERE "reassignment_pending" = true)
  AND "disposition" <> 'ignored';--> statement-breakpoint
DELETE FROM "products" WHERE "reassignment_pending" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "products_sku_unique" ON "products" USING btree ("sku");--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "reassignment_pending";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "reassignment_offer_id";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "reassignment_ozon_sku";
