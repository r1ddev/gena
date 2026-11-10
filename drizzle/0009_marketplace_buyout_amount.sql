ALTER TABLE "ozon_posting_items" ADD COLUMN "marketplace_buyout_amount" numeric(16, 2);
-- Rollback: ALTER TABLE "ozon_posting_items" DROP COLUMN "marketplace_buyout_amount";
