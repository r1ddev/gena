ALTER TABLE "ozon_posting_items" ADD COLUMN "is_marketplace_buyout" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ozon_posting_items" ADD COLUMN "marketplace_buyout_at" timestamp with time zone;--> statement-breakpoint
UPDATE "ozon_posting_items" AS item
SET "is_marketplace_buyout" = true,
    "marketplace_buyout_at" = posting."marketplace_buyout_at"
FROM "ozon_postings" AS posting
WHERE posting."id" = item."posting_id"
  AND (
    (
      jsonb_typeof(posting."raw" -> 'products') = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(posting."raw" -> 'products') AS raw_item
        WHERE raw_item ->> 'is_marketplace_buyout' = 'true'
          AND raw_item ->> 'sku' = item."ozon_sku"
      )
    )
    OR (posting."raw" ->> 'source' = 'legacy-import' AND lower(coalesce(item."raw" ->> 'status', '')) ~ '(выкуп|buyout)')
  );--> statement-breakpoint
UPDATE "ozon_postings" AS posting
SET "is_marketplace_buyout" = (
  EXISTS (SELECT 1 FROM "ozon_posting_items" AS item WHERE item."posting_id" = posting."id")
  AND NOT EXISTS (
    SELECT 1 FROM "ozon_posting_items" AS item
    WHERE item."posting_id" = posting."id" AND item."is_marketplace_buyout" = false
  )
);
