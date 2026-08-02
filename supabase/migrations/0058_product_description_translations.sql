-- Hand-written Japanese/Korean translations of a product's description, for
-- the new site-language feature (see LanguageContext.tsx). Nullable — falls
-- back to the English `description` on the storefront if not yet filled in.
-- Never applies to product name/title or brand, which stay untranslated per
-- the owner's explicit instruction.
alter table products add column description_ja text;
alter table products add column description_ko text;
