-- Fixes a stuck abandoned-cart cron: the 500-row oldest-first scan added in
-- commit 15fe278 (2026-09-20) only excluded already-sent carts in JS after
-- fetching, not in the query itself. Since nothing ever moves a cart out of
-- 'active' except checkout, the oldest 500 active+email carts filled up
-- entirely with carts that had already received every applicable send (or
-- were permanently empty), and the window never advanced again — zero
-- abandoned-cart sends since 2026-09-23. This function excludes carts
-- already sent THIS automation's step directly in SQL (NOT EXISTS against
-- cart_abandonment_sends, which already has a unique(cart_id,
-- email_automation_id) index with cart_id leading — no new index needed),
-- so the scan always surfaces genuinely-unprocessed carts instead of
-- re-scanning the same dead rows every run.
create or replace function get_eligible_abandoned_carts(
  p_automation_id uuid,
  p_cutoff timestamptz,
  p_limit int
)
returns table (
  id uuid,
  session_token text,
  email text,
  currency text,
  updated_at timestamptz,
  recovery_token text,
  unsubscribe_token text,
  abandoned_cart_discount_id uuid
)
language sql
stable
as $$
  select c.id, c.session_token, c.email, c.currency, c.updated_at,
         c.recovery_token, c.unsubscribe_token, c.abandoned_cart_discount_id
  from carts c
  where c.status = 'active'
    and c.email is not null
    and c.created_at <= p_cutoff
    and not exists (
      select 1 from cart_abandonment_sends s
      where s.cart_id = c.id and s.email_automation_id = p_automation_id
    )
  order by c.created_at asc
  limit p_limit;
$$;
