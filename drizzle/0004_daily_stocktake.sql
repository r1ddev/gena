WITH ranked_stocktakes AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY warehouse, counted_at
      ORDER BY created_at, id
    ) AS canonical_id
  FROM stocktakes
)
UPDATE stocktake_lines AS lines
SET stocktake_id = ranked_stocktakes.canonical_id
FROM ranked_stocktakes
WHERE lines.stocktake_id = ranked_stocktakes.id
  AND ranked_stocktakes.id <> ranked_stocktakes.canonical_id;

WITH ranked_stocktakes AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY warehouse, counted_at
      ORDER BY created_at, id
    ) AS canonical_id
  FROM stocktakes
)
DELETE FROM stocktakes AS duplicates
USING ranked_stocktakes
WHERE duplicates.id = ranked_stocktakes.id
  AND ranked_stocktakes.id <> ranked_stocktakes.canonical_id;

CREATE UNIQUE INDEX "stocktakes_warehouse_counted_at_uq" ON "stocktakes" USING btree ("warehouse","counted_at");
