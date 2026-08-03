-- Hand-written Japanese/Korean translations of the top promo banner text
-- (see storefront_banner) for the site-language feature. Nullable — falls
-- back to the English text on the storefront if not yet filled in.
alter table storefront_banner add column text_ja text;
alter table storefront_banner add column text_ko text;
