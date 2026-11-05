ALTER TABLE "supply_cargo_labels" ADD COLUMN "label_format_version" integer DEFAULT 0 NOT NULL;
UPDATE "supply_cargo_labels" SET "label_format_version" = 1 WHERE "label_png" IS NOT NULL;
