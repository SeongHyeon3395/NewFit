create table if not exists public.manual_meal_logs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date text not null,
  meal_type text not null,
  food_name text,
  calories numeric not null default 0,
  carbs_g numeric not null default 0,
  protein_g numeric not null default 0,
  fat_g numeric not null default 0,
  image_uri text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.manual_meal_logs enable row level security;

drop trigger if exists trg_manual_meal_logs_updated_at on public.manual_meal_logs;
create trigger trg_manual_meal_logs_updated_at
before update on public.manual_meal_logs
for each row execute function public.set_updated_at();

create index if not exists idx_manual_meal_logs_user_date
on public.manual_meal_logs (user_id, date desc, occurred_at desc);

drop policy if exists "select own manual_meal_logs" on public.manual_meal_logs;
create policy "select own manual_meal_logs"
on public.manual_meal_logs
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "insert own manual_meal_logs" on public.manual_meal_logs;
create policy "insert own manual_meal_logs"
on public.manual_meal_logs
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "update own manual_meal_logs" on public.manual_meal_logs;
create policy "update own manual_meal_logs"
on public.manual_meal_logs
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "delete own manual_meal_logs" on public.manual_meal_logs;
create policy "delete own manual_meal_logs"
on public.manual_meal_logs
for delete
to authenticated
using (user_id = auth.uid());
