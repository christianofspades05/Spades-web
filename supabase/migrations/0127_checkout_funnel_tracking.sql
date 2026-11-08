-- Step-level checkout funnel: the 10 new storefront_visits event_type
-- values fired between checkout_start (existing — see products/$slug.tsx)
-- and a placed/paid order (checkout_view, checkout_email_entered,
-- checkout_address_entered, checkout_shipping_shown,
-- checkout_payment_selected, checkout_place_order_clicked,
-- checkout_validation_error, checkout_order_error,
-- checkout_payment_redirect, checkout_order_success — see
-- lib/validation/analytics.ts's EVENT_TYPES and lib/analytics/
-- checkout-tracking.ts for how they're fired). No schema change needed for
-- the events themselves (same event_type/metadata jsonb columns 0007
-- already added) — this migration is just the reporting layer on top.
--
-- storefront_visits_event_type_created_at_idx on (event_type, created_at)
-- already exists (migration 0007) and covers every query below — nothing
-- to add there.

-- One row per day (America/Los_Angeles — the Meta ad account timezone,
-- deliberately different from the +08:00 fixed-offset trick the PH-local
-- visitor dashboards use — see 0121's doc comment for why that one's
-- fixed-offset; LA observes DST, so this uses a real IANA zone instead),
-- with distinct-visitor counts per funnel step and each step's conversion
-- off the one before it. Counts distinct visitor_id (not cart_id) to
-- match "distinct visitors per step" — see checkout_shipping_dropoff_by_
-- region below for the cart-level view of the shipping-fee drop-off
-- specifically.
create or replace view checkout_funnel_daily as
with counts as (
  select
    (created_at at time zone 'America/Los_Angeles')::date as day,
    count(distinct visitor_id)
      filter (where event_type = 'checkout_start') as checkout_start,
    count(distinct visitor_id)
      filter (where event_type = 'checkout_view') as checkout_view,
    count(distinct visitor_id)
      filter (where event_type = 'checkout_email_entered') as email_entered,
    count(distinct visitor_id)
      filter (where event_type = 'checkout_address_entered') as address_entered,
    count(distinct visitor_id)
      filter (where event_type = 'checkout_shipping_shown') as shipping_shown,
    count(distinct visitor_id)
      filter (where event_type = 'checkout_payment_selected') as payment_selected,
    count(distinct visitor_id)
      filter (where event_type = 'checkout_place_order_clicked') as place_order_clicked,
    count(distinct visitor_id)
      filter (where event_type = 'checkout_order_success') as order_success,
    count(distinct visitor_id) filter (
      where event_type = 'checkout_payment_selected'
        and metadata ->> 'method' = 'cod'
    ) as cod_selected,
    count(distinct visitor_id) filter (
      where event_type = 'checkout_payment_selected'
        and metadata ->> 'method' = 'online'
    ) as online_selected
  from storefront_visits
  where event_type in (
    'checkout_start',
    'checkout_view',
    'checkout_email_entered',
    'checkout_address_entered',
    'checkout_shipping_shown',
    'checkout_payment_selected',
    'checkout_place_order_clicked',
    'checkout_order_success'
  )
  group by 1
)
select
  day,
  checkout_start,
  checkout_view,
  email_entered,
  address_entered,
  shipping_shown,
  payment_selected,
  place_order_clicked,
  order_success,
  cod_selected,
  online_selected,
  round(100.0 * checkout_view / nullif(checkout_start, 0), 1)
    as start_to_view_pct,
  round(100.0 * email_entered / nullif(checkout_view, 0), 1)
    as view_to_email_pct,
  round(100.0 * address_entered / nullif(email_entered, 0), 1)
    as email_to_address_pct,
  round(100.0 * shipping_shown / nullif(address_entered, 0), 1)
    as address_to_shipping_pct,
  round(100.0 * payment_selected / nullif(shipping_shown, 0), 1)
    as shipping_to_payment_pct,
  round(100.0 * place_order_clicked / nullif(payment_selected, 0), 1)
    as payment_to_place_order_pct,
  round(100.0 * order_success / nullif(place_order_clicked, 0), 1)
    as place_order_to_success_pct,
  round(100.0 * order_success / nullif(checkout_start, 0), 1)
    as overall_start_to_success_pct
from counts
order by day desc;

comment on view checkout_funnel_daily is
  'Daily (America/Los_Angeles) checkout funnel — distinct visitors per step and step-to-step conversion %. Reads storefront_visits'' checkout_* events (see lib/analytics/checkout-tracking.ts). Admin-only: queried exclusively via the service-role client, same as discounts_with_status (0119) — no grant to anon/authenticated.';

-- Whether a shown shipping fee is actually what makes people leave:
-- shipping_shown -> place_order_clicked conversion, split by region and by
-- whether that fee was free (see shippingCostCents' free_shipping
-- metadata). Joined on cart_id (every checkout_* event's metadata carries
-- one — see trackCheckoutEvent), not visitor_id: the question here is
-- "did *this* shown fee lead to *this* checkout attempt placing an
-- order," which is a per-attempt (per-cart) question, not a per-visitor
-- one — a visitor who abandons once and succeeds on a second attempt
-- shouldn't make the first attempt's drop-off look like a conversion.
create or replace view checkout_shipping_dropoff_by_region as
with shipping as (
  select distinct
    metadata ->> 'cart_id' as cart_id,
    metadata ->> 'region' as region,
    (metadata ->> 'free_shipping')::boolean as free_shipping
  from storefront_visits
  where event_type = 'checkout_shipping_shown'
    and metadata ->> 'cart_id' is not null
),
placed as (
  select distinct metadata ->> 'cart_id' as cart_id
  from storefront_visits
  where event_type = 'checkout_place_order_clicked'
    and metadata ->> 'cart_id' is not null
)
select
  shipping.region,
  shipping.free_shipping,
  count(distinct shipping.cart_id) as shipping_shown_carts,
  count(distinct placed.cart_id) as place_order_clicked_carts,
  round(
    100.0 * count(distinct placed.cart_id)
      / nullif(count(distinct shipping.cart_id), 0),
    1
  ) as conversion_pct
from shipping
left join placed on placed.cart_id = shipping.cart_id
group by shipping.region, shipping.free_shipping
order by shipping.region, shipping.free_shipping;

comment on view checkout_shipping_dropoff_by_region is
  'shipping_shown -> place_order_clicked conversion by region and free_shipping, per cart_id. Reads storefront_visits'' checkout_shipping_shown/checkout_place_order_clicked events. Admin-only, same as checkout_funnel_daily above.';
