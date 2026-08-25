-- Hand-written Traditional Chinese translations, mirroring the existing
-- Japanese/Korean columns for the site-language feature (see
-- LanguageContext.tsx). Nullable — falls back to the English text on the
-- storefront if not yet filled in.
alter table storefront_sections add column title_zh text;
alter table storefront_sections add column subtitle_zh text;
alter table storefront_banner add column text_zh text;
alter table products add column description_zh text;
