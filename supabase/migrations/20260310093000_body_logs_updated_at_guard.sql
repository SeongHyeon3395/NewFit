alter table public.body_logs
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_body_logs_updated_at on public.body_logs;
create trigger trg_body_logs_updated_at
before update on public.body_logs
for each row execute function public.set_updated_at();
