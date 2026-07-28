-- Records the actual currency/amount a card payment was charged in when the
-- customer had selected a non-PHP display currency at checkout (Xendit's
-- card multi-currency processing — see lib/xendit/client.ts). Deliberately
-- additive and nullable: payments.amount_cents keeps meaning "PHP
-- settlement amount" exactly as every existing accounting/analytics read
-- of it already assumes; these columns only populate for a foreign-currency
-- card charge. NULL for COD, GCash, Maya, bank transfer, and any card
-- charge made in PHP.
alter table payments
  add column charged_currency text,
  add column charged_amount_cents integer,
  add column fx_rate_to_php numeric;
