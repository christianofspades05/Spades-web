-- Postgres treats a new parameter (even with a default) as a distinct
-- overload rather than replacing the old 3-arg signature from 0117 — drop
-- it explicitly so `get_eligible_abandoned_carts(uuid, timestamptz, int)`
-- calls don't become ambiguous between the two.
drop function if exists get_eligible_abandoned_carts(uuid, timestamptz, int);

-- 0117 fixed the stuck scan, but unguarded it would now drain a ~5-week,
-- 18k-cart backlog that piled up while the cron was broken (2026-09-23 to
-- present) — sending "you left this in your cart" for carts over a month
-- old, with a freshly-minted discount code attached, reads as stale/broken
-- to a customer rather than a timely nudge. Adds a floor on cart age so the
-- backlog of now-irrelevant carts is silently skipped (never sent, not
-- queued for later) while genuinely recent abandonments resume normally.
create or replace function get_eligible_abandoned_carts(
  p_automation_id uuid,
  p_cutoff timestamptz,
  p_limit int,
  p_max_age_days int default 7
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
    and c.created_at >= now() - (p_max_age_days || ' days')::interval
    and not exists (
      select 1 from cart_abandonment_sends s
      where s.cart_id = c.id and s.email_automation_id = p_automation_id
    )
  order by c.created_at asc
  limit p_limit;
$$;
