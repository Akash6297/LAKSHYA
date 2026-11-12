-- =============================================================================
-- Run ONCE in Supabase Dashboard → SQL Editor (not a migration, because it
-- contains your project URL and secret). Free tier includes pg_cron + pg_net.
-- Replace the two placeholders before running.
-- =============================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Secrets live in Supabase Vault (encrypted), not in the job definition.
select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'lakshya_project_url');
select vault.create_secret('YOUR-CRON-SECRET', 'lakshya_cron_secret');

select cron.schedule(
  'lakshya-dispatch-reminders',
  '* * * * *', -- every minute
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'lakshya_project_url') || '/functions/v1/dispatch-reminders',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'lakshya_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- Inspect:   select * from cron.job_run_details order by start_time desc limit 20;
-- Remove:    select cron.unschedule('lakshya-dispatch-reminders');
