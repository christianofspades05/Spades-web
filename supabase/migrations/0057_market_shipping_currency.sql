-- Tracks which currency a market's shipping_price_cents is actually
-- denominated in (e.g. SGD for a Singapore market) — previously always
-- assumed PHP. Existing rows default to PHP, matching how they were
-- entered before this column existed.
alter table markets add column shipping_currency text not null default 'PHP';
