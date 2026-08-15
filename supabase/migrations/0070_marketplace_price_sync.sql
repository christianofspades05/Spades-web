-- Lets a marketplace connection opt into automatically mirroring the
-- storefront's active sale price. price_markup_percent is how much higher
-- that channel's regular (non-sale) price sits above the website's own base
-- price_cents — e.g. Shopee listings are priced 10% above the website, so a
-- sale must be computed off that marked-up figure, not the raw website
-- price, or the pushed price would undercut by the markup amount.
alter table marketplace_connections
  add column price_sync_enabled boolean not null default false,
  add column price_markup_percent numeric not null default 0;

update marketplace_connections
  set price_markup_percent = 10
  where marketplace = 'shopee';
