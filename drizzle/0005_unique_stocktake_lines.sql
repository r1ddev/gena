DO $$
DECLARE
  duplicate_line RECORD;
  canonical_id uuid;
  line_ids uuid[];
BEGIN
  FOR duplicate_line IN
    SELECT
      stocktake_id,
      product_id,
      array_agg(id ORDER BY (resolved_at IS NOT NULL) DESC, created_at, id) AS ids,
      count(DISTINCT expected_quantity::text || ':' || actual_quantity::text) > 1 AS conflicting,
      string_agg(format('line %s expected=%s actual=%s', id, expected_quantity, actual_quantity), '; ' ORDER BY created_at, id) AS details
    FROM stocktake_lines
    GROUP BY stocktake_id, product_id
    HAVING count(*) > 1
  LOOP
    line_ids := duplicate_line.ids;
    canonical_id := line_ids[1];
    IF duplicate_line.conflicting THEN
      UPDATE stocktake_lines
      SET resolved_at = NULL,
          resolution_note = concat_ws(E'\n', NULLIF(resolution_note, ''), 'НУЖНА СВЕРКА: в исходных данных были разные значения одной инвентаризации. ' || duplicate_line.details)
      WHERE id = canonical_id;
      DELETE FROM stock_adjustments WHERE stocktake_line_id = ANY(line_ids);
    ELSE
      DELETE FROM stock_adjustments WHERE stocktake_line_id = ANY(line_ids[2:cardinality(line_ids)]);
    END IF;
    DELETE FROM stocktake_lines WHERE id = ANY(line_ids[2:cardinality(line_ids)]);
  END LOOP;
END $$;

CREATE UNIQUE INDEX "stocktake_lines_product_uq" ON "stocktake_lines" USING btree ("stocktake_id","product_id");
