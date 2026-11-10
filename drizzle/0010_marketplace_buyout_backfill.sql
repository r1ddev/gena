ALTER TABLE "app_settings" ADD COLUMN "marketplace_buyout_report_start_date" date;
-- Rollback: ALTER TABLE "app_settings" DROP COLUMN "marketplace_buyout_report_start_date";
