# server/customers

Server functions for customer profile and address-book management
(complements the RLS policies in `customer_addresses`, which already let a
signed-in customer manage their own rows directly from the browser client
for simple cases). Not implemented yet.

This is also where the COD-risk counters on `customers`
(`successful_orders_count`, `cancelled_orders_count`, `failed_delivery_count`,
`return_count`, `is_high_risk`, `cod_blocked`) get updated as order/return
lifecycle events happen — keep that logic here, not scattered across
`server/orders` and `server/checkout`.
