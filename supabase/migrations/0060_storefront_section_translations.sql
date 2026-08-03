-- Hand-written Japanese/Korean translations of a storefront section's
-- title/subtitle (hero taglines, product-grid headings like "New Release")
-- for the site-language feature (see LanguageContext.tsx). Nullable — falls
-- back to the English title/subtitle on the storefront if not yet filled in.
alter table storefront_sections add column title_ja text;
alter table storefront_sections add column title_ko text;
alter table storefront_sections add column subtitle_ja text;
alter table storefront_sections add column subtitle_ko text;
