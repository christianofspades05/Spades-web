-- Extends the section editor (0031_storefront_sections.sql) beyond just the
-- homepage — staff asked for the About page to be editable the same way.
-- `page` scopes a section to whichever page renders it; sort_order is only
-- meaningful within one page, not globally, since each page has its own
-- independent block order.
alter table storefront_sections
  add column page text not null default 'home'
  check (page in ('home', 'about'));

-- The existing sort_order index assumed one global order — replace it with
-- one that's actually useful for "give me page X's sections in order".
drop index if exists storefront_sections_sort_order_idx;
create index storefront_sections_page_sort_order_idx
  on storefront_sections (page, sort_order);
