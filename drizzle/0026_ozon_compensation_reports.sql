CREATE TABLE "ozon_compensation_reports" (
	"report_month" text PRIMARY KEY NOT NULL,
	"report_number" text DEFAULT '' NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "ozon_compensation_report_history_start_date" date;