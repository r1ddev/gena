CREATE TABLE "ozon_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_key" text NOT NULL,
	"period_id" text NOT NULL,
	"period_begin" date NOT NULL,
	"period_end" date NOT NULL,
	"currency_code" text DEFAULT 'RUB' NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ozon_payouts_external_key_unique" UNIQUE("external_key")
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "ozon_payout_history_start_date" date;--> statement-breakpoint
CREATE INDEX "ozon_payouts_period_idx" ON "ozon_payouts" USING btree ("period_id");