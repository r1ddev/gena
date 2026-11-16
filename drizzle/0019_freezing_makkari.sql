CREATE TABLE "scenario_calculations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"profit" numeric(16, 2) NOT NULL,
	"profit_share" numeric(12, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "scenario_calculations_created_idx" ON "scenario_calculations" USING btree ("created_at");