ALTER TABLE "supplies" ADD COLUMN "marketplace" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplies" ADD COLUMN "ozon_supply_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "supplies_ozon_supply_id_unique_idx" ON "supplies" USING btree ("ozon_supply_id");--> statement-breakpoint
ALTER TABLE "supplies" ADD CONSTRAINT "supplies_marketplace_check" CHECK ("supplies"."marketplace" IN ('ozon', 'wb', 'avito', 'other', 'unknown'));