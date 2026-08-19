-- Adds PayPal as a payment_provider — used for non-Philippines online
-- checkouts, which need to actually charge a customer's real currency
-- (SGD, etc.) rather than Xendit's PHP-only legacy Invoice API. See
-- server/checkout/place-order.ts for the country-based routing.
alter type payment_provider add value 'paypal';
