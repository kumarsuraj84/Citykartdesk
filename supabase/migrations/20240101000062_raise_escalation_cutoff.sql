-- Raise the Stage-2 escalation cutoff from 70 → 85.
--
-- The pipeline escalates a message to Stage 2 only while the rules engine's
-- confidence stays BELOW escalate_below_confidence. At 70, the bulk of mail
-- (rules score in the 70–89 band) never reached the model. Raising to 85 lets
-- the model second-opinion the uncertain ACTIONABLE mail. Confident no-work mail
-- (FYI/junk, scored ≥80) is exempted in the orchestrator so newsletters still
-- never escalate and waste LLM calls.
--
-- loadConfig() reads this stored row first (code DEFAULT_CONFIG is only a
-- fallback), so existing orgs need this data write to pick up the new behaviour.

UPDATE intake_pipeline_config
SET config = jsonb_set(config, '{escalate_below_confidence}', '85'::jsonb)
WHERE (config->>'escalate_below_confidence')::int = 70;
