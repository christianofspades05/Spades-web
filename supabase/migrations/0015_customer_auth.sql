-- Customer accounts, built on Supabase Auth rather than a hand-rolled
-- password/session system. auth.users already handles password hashing,
-- email confirmation, OAuth, and cookie/session management — and
-- customers.auth_user_id + the "own row" RLS policies in 0001_init_schema.sql
-- already assume this is how customer auth would work. There is no
-- password_hash column here: Supabase stores that in
-- auth.users.encrypted_password, and a second copy on customers would just
-- be a second place for a password to leak from.
create type customer_auth_provider as enum ('email', 'google');
-- 'phone' gets added the same way later (`alter type customer_auth_provider
-- add value 'phone'`) once phone verification actually ships — Supabase
-- Auth supports phone/SMS providers natively too, so this stays a one-line
-- enum change, not a restructure.

alter table customers
  add column auth_provider customer_auth_provider,
  add column google_id text,
  add column phone_number text,
  add column email_verified boolean not null default false,
  add column phone_verified boolean not null default false,
  add column last_login_at timestamptz;

create unique index customers_google_id_key on customers (google_id) where google_id is not null;

-- Auto-provisions (or links) a customers row whenever someone completes
-- Supabase Auth signup (email/password or Google). customers.email has a
-- unique index (0001_init_schema.sql), so if a customers row already exists
-- with this email and no auth_user_id yet — a prior guest checkout, or an
-- email-signup account whose first Google login is completing it — link
-- that row instead of inserting a duplicate that would violate uniqueness.
-- This is what satisfies "link accounts rather than duplicate" for Google
-- sign-in against an existing email.
create function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider text := coalesce(new.raw_app_meta_data->>'provider', 'email');
  v_existing_id uuid;
begin
  select id into v_existing_id
  from customers
  where lower(email) = lower(new.email) and auth_user_id is null
  limit 1;

  if v_existing_id is not null then
    update customers
    set auth_user_id = new.id,
        is_guest = false,
        auth_provider = case
          when v_provider = 'google' then 'google'::customer_auth_provider
          else coalesce(auth_provider, 'email'::customer_auth_provider)
        end,
        google_id = case
          when v_provider = 'google' then new.raw_user_meta_data->>'sub'
          else google_id
        end,
        email_verified = (new.email_confirmed_at is not null)
    where id = v_existing_id;
  else
    insert into customers (
      auth_user_id, email, full_name, is_guest, auth_provider, google_id, email_verified
    )
    values (
      new.id,
      new.email,
      new.raw_user_meta_data->>'full_name',
      false,
      case when v_provider = 'google' then 'google' else 'email' end::customer_auth_provider,
      case when v_provider = 'google' then new.raw_user_meta_data->>'sub' else null end,
      new.email_confirmed_at is not null
    )
    on conflict (auth_user_id) do nothing;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function handle_new_auth_user();

-- Mirrors auth.users' email confirmation / last-sign-in state onto
-- customers, so admin/staff code can read verification status and login
-- recency straight off the customers table instead of calling the separate
-- auth admin API.
create function sync_customer_auth_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update customers
  set email_verified = (new.email_confirmed_at is not null),
      last_login_at = new.last_sign_in_at
  where auth_user_id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_updated
after update of email_confirmed_at, last_sign_in_at on auth.users
for each row
execute function sync_customer_auth_state();
