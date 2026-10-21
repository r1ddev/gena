ALTER TABLE "products" DROP CONSTRAINT "products_sku_unique";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "reassignment_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "reassignment_offer_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "reassignment_ozon_sku" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "products_sku_active_unique_idx" ON "products" USING btree ("sku") WHERE "products"."reassignment_pending" = false;