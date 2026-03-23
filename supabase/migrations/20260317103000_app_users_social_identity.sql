-- Add optional social identity columns for app_users.
-- No table recreation required.

alter table if exists public.app_users
  add column if not exists social_provider text,
  add column if not exists social_provider_user_id text,
  add column if not exists phone_e164 text;

-- Avoid duplicated provider user id rows (when present).
create unique index if not exists ux_app_users_social_provider_user_id
  on public.app_users (social_provider, social_provider_user_id)
  where social_provider is not null and social_provider_user_id is not null;
