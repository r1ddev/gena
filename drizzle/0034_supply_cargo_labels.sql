CREATE TABLE "supply_cargo_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supply_id" uuid NOT NULL,
	"ozon_supply_id" text NOT NULL,
	"cargo_id" text NOT NULL,
	"cargo_type" text DEFAULT '' NOT NULL,
	"bundle_id" text DEFAULT '' NOT NULL,
	"label_png" "bytea",
	"label_error" text DEFAULT '' NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supply_cargo_labels" ADD CONSTRAINT "supply_cargo_labels_supply_id_supplies_id_fk" FOREIGN KEY ("supply_id") REFERENCES "public"."supplies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supply_cargo_labels_supply_cargo_unique_idx" ON "supply_cargo_labels" USING btree ("supply_id","cargo_id");--> statement-breakpoint
CREATE INDEX "supply_cargo_labels_supply_idx" ON "supply_cargo_labels" USING btree ("supply_id");