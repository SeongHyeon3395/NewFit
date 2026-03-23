-- Auto-provision app_users rows for OAuth and any auth-created users.
-- This keeps app profile data consistent even when signup-device is not used.

create or replace function public.create_app_user_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username_seed text;
  v_username text;
  v_nickname text;
  v_exists boolean;
  v_try int := 0;
begin
  -- If row already exists, keep existing data.
  if exists (select 1 from public.app_users where id = new.id) then
    return new;
  end if;

  v_username_seed := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    nullif(trim(new.raw_user_meta_data ->> 'preferred_username'), ''),
    'user'
  );

  v_username := lower(v_username_seed);
  v_username := regexp_replace(v_username, '[^a-z0-9_]', '_', 'g');
  v_username := regexp_replace(v_username, '^_+|_+$', '', 'g');
  v_username := regexp_replace(v_username, '_{2,}', '_', 'g');
  if v_username = '' then
    v_username := 'user';
  end if;
  v_username := left(v_username, 24);

  loop
    select exists(select 1 from public.app_users where username = v_username) into v_exists;
    exit when not v_exists;

    v_try := v_try + 1;
    v_username := left(v_username, 15) || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
    exit when v_try >= 8;
  end loop;

  if v_exists then
    v_username := 'user_' || substr(md5(new.id::text || clock_timestamp()::text), 1, 8);
  end if;

  v_nickname := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'nickname'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    v_username
  );

  insert into public.app_users (id, username, nickname, device_id)
  values (new.id, v_username, left(v_nickname, 30), null)
  on conflict (id) do nothing;

  return new;
end;
$$;

alter function public.create_app_user_from_auth_user() owner to postgres;

-- Create profile row whenever a new auth user is created.
drop trigger if exists trg_auth_users_create_app_user on auth.users;
create trigger trg_auth_users_create_app_user
after insert on auth.users
for each row execute function public.create_app_user_from_auth_user();
