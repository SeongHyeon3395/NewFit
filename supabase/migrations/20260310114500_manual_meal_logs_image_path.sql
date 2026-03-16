alter table if exists public.manual_meal_logs
  add column if not exists image_path text;

create index if not exists idx_manual_meal_logs_user_date_image
on public.manual_meal_logs (user_id, date desc, occurred_at desc);
