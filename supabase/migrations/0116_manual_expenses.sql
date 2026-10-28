-- -----------------------------------------------------------------------------
-- manual_expenses
-- Hand-entered expense line items for the admin Expenses page (ads/TikTok/
-- Shopee fees on that page are computed from other tables/APIs, not stored
-- here — this table is only for costs with no other source, e.g. rent,
-- packaging, salaries). No RLS policies defined (deny-all for anon/
-- authenticated) — only the service-role admin client reads/writes this,
-- gated by requireStaff() in src/server/admin/expenses.ts.
-- -----------------------------------------------------------------------------
create table manual_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  category text not null,
  description text,
  amount_cents integer not null check (amount_cents >= 0),
  created_by uuid references staff_users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index manual_expenses_date_idx on manual_expenses (expense_date desc);

alter table manual_expenses enable row level security;
