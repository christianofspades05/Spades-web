-- -----------------------------------------------------------------------------
-- meta_campaign_product_mappings
-- Manual mapping from a Meta/Facebook ad campaign (matched by its name — the
-- same name captured client-side as orders.ad_campaign_name, see
-- 0123_order_ad_campaign_attribution.sql, and reported by Windsor.ai's own
-- per-campaign spend breakdown) to the product it advertises, e.g. a "Denim
-- Flare Best Seller" campaign maps to that denim product. Lets the admin Ads
-- Efficiency page show ROAS/cost-per-purchase per campaign. No automatic
-- matching — campaign naming isn't reliable enough to parse, so staff set
-- this explicitly from the admin Campaign Mapping screen
-- (src/server/admin/campaign-mapping.ts). No RLS policies defined (deny-all
-- for anon/authenticated) — only the service-role admin client reads/writes
-- this, gated by requireStaff() there.
-- -----------------------------------------------------------------------------
create table meta_campaign_product_mappings (
  id uuid primary key default gen_random_uuid(),
  campaign_name text not null unique,
  product_id uuid references products (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at
  before update on meta_campaign_product_mappings
  for each row execute function set_updated_at();

alter table meta_campaign_product_mappings enable row level security;
