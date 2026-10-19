-- Agent runtime ledger: make lifecycle-only writes observable.
--
-- paperclip_agent_runtime_changed() (created in 0347_flippant_imperial_guard.sql)
-- short-circuits on a fixed array of twelve agent columns. `status`, `pause_reason`
-- and `paused_at` are NOT in that array, so a write that only changes agent
-- lifecycle state returns NEW and writes no resource_lifecycle_events row. Any
-- writer that goes around recordAgentStatusEvent -- a host-level script, a manual
-- UPDATE, a migration -- therefore pauses an agent with zero ledger evidence.
--
-- This migration widens the compared array to fifteen columns so a lifecycle-only
-- write falls through to paperclip_record_agent_runtime(), and records an
-- activity_log row whenever a lifecycle column is one of the changed columns.
--
-- Notes:
--   * The no-op short-circuit is preserved. jsonb_build_array renders SQL NULL as
--     a JSON null, so a column that is NULL on both sides compares equal and a
--     genuine no-op update still returns early.
--   * Idempotent: CREATE OR REPLACE FUNCTION plus DROP TRIGGER IF EXISTS. Re-running
--     rewrites the same functions and recreates the same trigger; it inserts no rows
--     and mutates no existing ledger rows.
--   * Superset of 0347 and 0354. 0354 redefined paperclip_record_agent_runtime to
--     FOR NO KEY UPDATE and left this trigger function untouched, so this body is
--     0347's body with the lifecycle columns added.
CREATE OR REPLACE FUNCTION paperclip_agent_runtime_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  lifecycle_changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO resource_lifecycle_events(company_id, resource_type, resource_id, action)
      VALUES (OLD.company_id, 'agent_runtime', OLD.id, 'delete');
    RETURN OLD;
  END IF;
  -- Only an UPDATE can transition lifecycle columns. On INSERT OLD is an unassigned
  -- record whose fields read as NULL, so gating on TG_OP keeps every insert from
  -- being misreported as a lifecycle transition.
  lifecycle_changed := TG_OP = 'UPDATE' AND (
      OLD.status IS DISTINCT FROM NEW.status
   OR OLD.pause_reason IS DISTINCT FROM NEW.pause_reason
   OR OLD.paused_at IS DISTINCT FROM NEW.paused_at);
  IF TG_OP = 'UPDATE' AND
    jsonb_build_array(OLD.name, OLD.role, OLD.title, OLD.capabilities, OLD.reports_to, OLD.adapter_type, OLD.adapter_config, OLD.runtime_config, OLD.default_environment_id, OLD.permissions, OLD.metadata, OLD.lifecycle_required_plugin_ids, OLD.status, OLD.pause_reason, OLD.paused_at)
    IS NOT DISTINCT FROM
    jsonb_build_array(NEW.name, NEW.role, NEW.title, NEW.capabilities, NEW.reports_to, NEW.adapter_type, NEW.adapter_config, NEW.runtime_config, NEW.default_environment_id, NEW.permissions, NEW.metadata, NEW.lifecycle_required_plugin_ids, NEW.status, NEW.pause_reason, NEW.paused_at)
    AND NOT (OLD.status = 'pending_approval' AND NEW.status <> 'pending_approval')
    AND NOT (NEW.lifecycle_state = 'ready' AND OLD.lifecycle_state <> 'ready') THEN
    RETURN NEW;
  END IF;
  PERFORM paperclip_record_agent_runtime(NEW.company_id, NEW.id);
  IF lifecycle_changed THEN
    INSERT INTO activity_log(company_id, actor_type, actor_id, action, entity_type, entity_id, agent_id, details)
      VALUES (NEW.company_id, 'system', 'database_trigger', 'agent.lifecycle_changed', 'agent', NEW.id::text, NEW.id,
        jsonb_build_object(
          'source', 'paperclip_agent_runtime_changed',
          'status', jsonb_build_object('from', OLD.status, 'to', NEW.status),
          'pauseReason', jsonb_build_object('from', OLD.pause_reason, 'to', NEW.pause_reason),
          'pausedAt', jsonb_build_object('from', OLD.paused_at, 'to', NEW.paused_at)
        ));
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS paperclip_agent_runtime_changed ON agents;
CREATE TRIGGER paperclip_agent_runtime_changed AFTER INSERT OR UPDATE OR DELETE ON agents
  FOR EACH ROW EXECUTE FUNCTION paperclip_agent_runtime_changed();