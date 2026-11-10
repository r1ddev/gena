DROP INDEX "product_links_external_idx";--> statement-breakpoint
DROP INDEX "product_links_product_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "product_links_product_unique_idx" ON "product_links" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_links_offer_id_unique_idx" ON "product_links" USING btree ("offer_id") WHERE "product_links"."offer_id" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX "product_links_ozon_sku_unique_idx" ON "product_links" USING btree ("ozon_sku") WHERE "product_links"."ozon_sku" IS NOT NULL AND "product_links"."ozon_sku" <> '';