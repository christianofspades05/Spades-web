-- Editable top promo banner, one row per brand — same shape as
-- storefront_maintenance_mode (0052). Publicly readable (nothing
-- sensitive in it, same reasoning as that table's policy), writable only
-- by the service-role admin client.
create table storefront_banner (
  brand text primary key check (brand in ('spades', 'ysrael', 'aspire365')),
  text text not null default '',
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Seeded with today's hardcoded copy (see server/storefront/domain.ts's
-- SCOPES) so nothing changes visually until someone edits it in the admin.
insert into storefront_banner (brand, text) values
  ('spades', 'Free shipping minimum of ₱2,000 purchase. Extra 10% off minimum of 5 items'),
  ('ysrael', 'Free shipping minimum of ₱2,500 worth of items'),
  ('aspire365', '');

alter table storefront_banner enable row level security;

create policy "Storefront banner is publicly readable"
  on storefront_banner for select
  using (true);

-- No insert/update/delete policy — only the service-role admin writes.
