-- Backfill: expire pending interactions on closed issues (done/cancelled).
--
-- These rows exist because the cascade that expires interactions on close
-- either ran before this interaction was created or intentionally skipped
-- ask_user_questions that were "historical" (had a newer human comment).
-- The resolution guard already blocks all transitions on closed issues with
-- 409 interaction_issue_closed, so keeping them pending only traps them in
-- /attention forever. Expire them now with outcome "issue_closed".
UPDATE "issue_thread_interactions" AS iti
SET
  "status"      = 'expired',
  "result"      = CASE iti."kind"
                    WHEN 'connection_intent' THEN
                      jsonb_build_object('version', 1, 'outcome', 'expired', 'reason', null)
                    WHEN 'ask_user_questions' THEN
                      jsonb_build_object('version', 1, 'outcome', 'issue_closed', 'reason', null,
                                         'answers', '[]'::jsonb, 'summaryMarkdown', null)
                    WHEN 'request_item_verdicts' THEN
                      jsonb_build_object('version', 1, 'outcome', 'issue_closed', 'reason', null,
                                         'complete', false, 'items', '[]'::jsonb)
                    ELSE
                      jsonb_build_object('version', 1, 'outcome', 'issue_closed', 'reason', null)
                  END,
  "resolved_at" = now(),
  "updated_at"  = now()
FROM "issues" AS i
WHERE iti."issue_id"  = i."id"
  AND iti."status"    = 'pending'
  AND i."status"      IN ('done', 'cancelled');
