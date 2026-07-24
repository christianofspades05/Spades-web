-- Admin "Email" marketing feature: a fixed set of lifecycle email
-- automations (welcome, abandoned cart, post-purchase review, birthday)
-- staff can configure content/schedule/discount for, plus the
-- customers.date_of_birth field the birthday automation and future segments
-- will read. abandoned_cart and post_purchase_review are seeded with the
-- content their existing hardcoded crons used to send — see
-- src/routes/api/cron/abandoned-cart.ts and review-requests.ts, which now
-- read from this table instead.

-- -----------------------------------------------------------------------------
-- email_automations
-- One row per fixed event type — never created/deleted from the admin UI,
-- only configured. A UNIQUE constraint on event_type (not just the surrogate
-- id) is what actually matters here, since the app always looks a row up by
-- event_type.
-- -----------------------------------------------------------------------------
create table email_automations (
  id uuid primary key default gen_random_uuid(),
  event_type text not null unique check (
    event_type in ('welcome', 'abandoned_cart', 'post_purchase_review', 'birthday')
  ),
  name text not null,
  is_active boolean not null default false,
  subject text not null default '',
  -- Ordered list of content blocks (header_image, heading, text, button,
  -- discount_code, cart_items, order_items, footer) — loosely typed jsonb
  -- rather than per-block columns, same reasoning as storefront_sections
  -- (0031_storefront_sections.sql): block shape varies by type and Postgres
  -- can't cleanly express "required only when type = X", so per-block-type
  -- field requirements are enforced at the app layer instead (see
  -- lib/validation/admin/email-automations.ts).
  blocks jsonb not null default '[]',
  discount_id uuid references discounts (id) on delete set null,
  -- Hours after the triggering event before sending. 1 for abandoned_cart
  -- (matches the existing cron's 1-hour inactivity threshold), 336 (14 days)
  -- for post_purchase_review (matches the existing review-request cron).
  -- Unused (0) for welcome (sent immediately on signup) and birthday
  -- (date-matched, not delay-based).
  delay_hours integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- abandoned_cart and post_purchase_review are seeded active with content
-- matching the hardcoded copy the two crons sent before this migration
-- (see the now-deleted lib/email/templates/abandoned-cart.ts and
-- review-request.ts), so migrating onto this table is a content-preserving
-- rename, not a silent switch to blank emails. welcome/birthday start
-- inactive with no content since they're new, unbuilt automations.
insert into email_automations (event_type, name, is_active, subject, blocks, delay_hours) values
  ('welcome', 'Welcome email (1st-time customer)', false, '', '[]', 0),
  (
    'abandoned_cart',
    'Abandoned cart',
    true,
    'You left something in your cart',
    '[
      {"type": "heading", "text": "Still thinking it over?"},
      {"type": "text", "text": "You left some items in your cart at Spades. They''re still here whenever you''re ready."},
      {"type": "cart_items"},
      {"type": "discount_code"},
      {"type": "button", "buttonLabel": "Back to your cart", "buttonUrl": "{{resumeUrl}}"},
      {"type": "footer"}
    ]',
    1
  ),
  (
    'post_purchase_review',
    'Post-purchase review request',
    true,
    'How was your order? Leave a review',
    '[
      {"type": "text", "text": "Hi {{customerFirstName}},"},
      {"type": "text", "text": "Thanks for your order {{orderNumber}} from Spades! We''d love to know what you thought — it only takes a minute."},
      {"type": "order_items"},
      {"type": "discount_code"},
      {"type": "button", "buttonLabel": "Rate & review your order", "buttonUrl": "{{reviewUrl}}"},
      {"type": "text", "text": "This link is unique to your order and can only be used once."}
    ]',
    336
  ),
  ('birthday', 'Birthday email', false, '', '[]', 0);

-- Staff-only resource, same convention as discounts/inventory/etc: RLS
-- enabled with zero client-facing policies — only the service-role key
-- (server-only, via the admin server fns) can touch this table.
alter table email_automations enable row level security;

-- Storage bucket for email header-image blocks — same pattern as
-- storefront-sections (0031_storefront_sections.sql): uploads always go
-- through the admin server function using the service-role client, so a
-- public bucket with no RLS policies is enough for the resulting URLs to be
-- viewable inside a sent email.
insert into storage.buckets (id, name, public)
values ('email-images', 'email-images', true)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- customers.date_of_birth
-- Captured once at signup, immutable afterward — enforced here via a
-- trigger (not just app-layer validation) since customers already have a
-- direct "update own row" RLS policy that would otherwise let them change it
-- straight through the client SDK.
-- -----------------------------------------------------------------------------
alter table customers add column date_of_birth date;

create function prevent_date_of_birth_change() returns trigger
language plpgsql
as $$
begin
  if old.date_of_birth is not null and new.date_of_birth is distinct from old.date_of_birth then
    raise exception 'date_of_birth cannot be changed once set';
  end if;
  return new;
end;
$$;

create trigger customers_date_of_birth_immutable
  before update on customers
  for each row execute function prevent_date_of_birth_change();

-- Extends handle_new_auth_user() (0015_customer_auth.sql) to also persist
-- date_of_birth from the signup form's auth.signUp({ options: { data: {...} } })
-- metadata — same raw_user_meta_data mechanism full_name already uses below,
-- just one more field read off it. Re-created in full (not just altered)
-- since Postgres has no partial-function-body ALTER.
create or replace function handle_new_auth_user()
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
        email_verified = (new.email_confirmed_at is not null),
        date_of_birth = coalesce(date_of_birth, nullif(new.raw_user_meta_data->>'date_of_birth', '')::date)
    where id = v_existing_id;
  else
    insert into customers (
      auth_user_id, email, full_name, is_guest, auth_provider, google_id, email_verified, date_of_birth
    )
    values (
      new.id,
      new.email,
      new.raw_user_meta_data->>'full_name',
      false,
      case when v_provider = 'google' then 'google' else 'email' end::customer_auth_provider,
      case when v_provider = 'google' then new.raw_user_meta_data->>'sub' else null end,
      new.email_confirmed_at is not null,
      nullif(new.raw_user_meta_data->>'date_of_birth', '')::date
    )
    on conflict (auth_user_id) do nothing;
  end if;

  return new;
end;
$$;
