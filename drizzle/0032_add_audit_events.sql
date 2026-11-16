CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"entity_type" text NOT NULL,
	"action" text NOT NULL,
	"record_key" text DEFAULT '' NOT NULL,
	"transaction_id" text NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb,
	"changed_fields" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_record_idx" ON "audit_events" USING btree ("entity_type","record_key");--> statement-breakpoint
CREATE INDEX "audit_events_source_idx" ON "audit_events" USING btree ("source");
--> statement-breakpoint
CREATE FUNCTION audit_redact_json(value jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  cleaned jsonb;
BEGIN
  IF value IS NULL THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(value) = 'object' THEN
    SELECT COALESCE(jsonb_object_agg(entry.key, audit_redact_json(entry.value)), '{}'::jsonb)
    INTO cleaned
    FROM jsonb_each(value) AS entry
    WHERE entry.key !~* '(^|_)(raw|data|body|password|secret|token|authorization|phone|email|address|recipient|customer|contact|passport)(_|$)|api.?key|encrypted';
    RETURN cleaned;
  END IF;

  IF jsonb_typeof(value) = 'array' THEN
    SELECT COALESCE(jsonb_agg(audit_redact_json(entry.value)), '[]'::jsonb)
    INTO cleaned
    FROM jsonb_array_elements(value) AS entry(value);
    RETURN cleaned;
  END IF;

  RETURN value;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION audit_clean_row(row_data jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN row_data IS NULL THEN NULL
    ELSE COALESCE(
      jsonb_object_agg(field.key, audit_redact_json(field.value)),
      '{}'::jsonb
    )
  END
  FROM jsonb_each(COALESCE(row_data, '{}'::jsonb)) AS field
  WHERE field.key !~* '(^|_)(raw|data|body|created_at|updated_at|last_seen_at|imported_at)$|api.?key|password|secret|encrypted|token|authorization';
$$;
--> statement-breakpoint
CREATE FUNCTION audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_row jsonb;
  new_row jsonb;
  clean_old jsonb;
  clean_new jsonb;
  changed jsonb;
  source_name text;
  row_key text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    old_row := to_jsonb(OLD);
    clean_old := audit_clean_row(old_row);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    new_row := to_jsonb(NEW);
    clean_new := audit_clean_row(new_row);
  END IF;

  IF TG_OP = 'UPDATE' AND clean_old IS NOT DISTINCT FROM clean_new THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(jsonb_object_agg(keys.key, jsonb_build_object(
    'before', COALESCE(clean_old, '{}'::jsonb) -> keys.key,
    'after', COALESCE(clean_new, '{}'::jsonb) -> keys.key
  )), '{}'::jsonb)
  INTO changed
  FROM jsonb_object_keys(COALESCE(clean_old, '{}'::jsonb) || COALESCE(clean_new, '{}'::jsonb)) AS keys(key)
  WHERE (COALESCE(clean_old, '{}'::jsonb) -> keys.key) IS DISTINCT FROM (COALESCE(clean_new, '{}'::jsonb) -> keys.key);

  row_key := COALESCE(
    new_row ->> 'id', old_row ->> 'id',
    new_row ->> 'external_key', old_row ->> 'external_key',
    new_row ->> 'external_id', old_row ->> 'external_id',
    new_row ->> 'source_key', old_row ->> 'source_key',
    new_row ->> 'report_month', old_row ->> 'report_month',
    new_row ->> 'period_id', old_row ->> 'period_id',
    new_row ->> 'sku', old_row ->> 'sku', ''
  );
  source_name := COALESCE(NULLIF(current_setting('application_name', true), ''), 'unknown');
  IF source_name = 'gena-migrate' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  INSERT INTO audit_events (
    source, entity_type, action, record_key, transaction_id,
    before_data, after_data, changed_fields
  ) VALUES (
    source_name, TG_TABLE_NAME, TG_OP, row_key, txid_current()::text,
    clean_old, clean_new, changed
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  table_record record;
BEGIN
  FOR table_record IN
    SELECT relation.relname
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind = 'r'
      AND relation.relname NOT IN ('audit_events', 'sync_jobs', '__drizzle_migrations')
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION audit_row_change()',
      'audit_' || table_record.relname,
      table_record.relname
    );
  END LOOP;
END $$;
