CREATE TABLE "purchase_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_receipt_id_purchase_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."purchase_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_receipt_lines_receipt_idx" ON "purchase_receipt_lines" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "purchase_receipt_lines_product_idx" ON "purchase_receipt_lines" USING btree ("product_id");--> statement-breakpoint
INSERT INTO "purchase_receipt_lines" ("receipt_id", "product_id", "quantity", "created_at")
SELECT "purchase_receipts"."id", "purchases"."product_id", "purchase_receipts"."received_quantity", "purchase_receipts"."created_at"
FROM "purchase_receipts"
JOIN "purchases" ON "purchases"."id" = "purchase_receipts"."purchase_id";--> statement-breakpoint
ALTER TABLE "purchase_receipts" DROP COLUMN "received_quantity";--> statement-breakpoint
ALTER TABLE "purchase_receipts" DROP COLUMN "unit_cost";
