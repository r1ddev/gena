DROP INDEX "product_links_offer_id_unique_idx";--> statement-breakpoint
DROP INDEX "product_links_ozon_sku_unique_idx";--> statement-breakpoint
ALTER TABLE "product_links" ALTER COLUMN "ozon_sku" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "product_links_offer_id_unique_idx" ON "product_links" USING btree ("offer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_links_ozon_sku_unique_idx" ON "product_links" USING btree ("ozon_sku");--> statement-breakpoint
ALTER TABLE "product_links" ADD CONSTRAINT "product_links_identifiers_present_check" CHECK ("product_links"."offer_id" <> '' AND "product_links"."ozon_sku" <> '');