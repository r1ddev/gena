UPDATE "app_settings" SET "accounting_start_date" = '2025-10-20' WHERE "accounting_start_date" IS NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "accounting_start_date" SET DEFAULT '2025-10-20';--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "accounting_start_date" SET NOT NULL;
