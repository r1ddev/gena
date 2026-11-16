ALTER TABLE "supply_lines" ADD COLUMN "purchase_unit_cost_snapshot" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "supply_lines" ADD COLUMN "landed_unit_cost_snapshot" numeric(16, 2);