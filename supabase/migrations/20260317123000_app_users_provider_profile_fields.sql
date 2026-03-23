-- Store provider profile fields (display name/avatar URL) for social-first onboarding UX.

alter table if exists public.app_users
  add column if not exists provider_full_name text,
  add column if not exists provider_avatar_url text;
