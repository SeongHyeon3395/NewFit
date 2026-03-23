-- Preserve optional Kakao profile fields for onboarding prefill and later analytics.

alter table if exists public.app_users
  add column if not exists provider_age_range text,
  add column if not exists provider_birthyear integer,
  add column if not exists provider_birthday text;
