CREATE OR REPLACE FUNCTION audit_row_change()
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
  owner_id uuid;
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

  owner_id := COALESCE(
    NULLIF(new_row ->> 'user_id', '')::uuid,
    NULLIF(old_row ->> 'user_id', '')::uuid
  );
  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Cannot attribute audit event for %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;

  INSERT INTO audit_events (
    user_id, source, entity_type, action, record_key, transaction_id,
    before_data, after_data, changed_fields
  ) VALUES (
    owner_id, source_name, TG_TABLE_NAME, TG_OP, row_key, txid_current()::text,
    clean_old, clean_new, changed
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
