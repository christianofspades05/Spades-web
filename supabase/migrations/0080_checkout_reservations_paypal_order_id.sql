-- Mirrors xendit_invoice_id — tracks the PayPal order id created for a
-- non-PH online-payment checkout, so the return/capture route and the
-- PayPal webhook safety net can both look the reservation back up by it.
alter table checkout_reservations add column paypal_order_id text;

create unique index checkout_reservations_paypal_order_id_key
  on checkout_reservations (paypal_order_id)
  where paypal_order_id is not null;
