-- -----------------------------------------------------------------------------
-- Let one Meta campaign map to several products (e.g. a "3 SHIRTS NEW"
-- campaign advertising three tees). Each row is now one campaign→product
-- pair; the Ads Efficiency page splits a campaign's spend evenly across its
-- mapped products (see getCampaignAdsPerformance in
-- src/server/admin/analytics.ts).
--
-- Rows with a null product_id were "unmapped" placeholders under the old
-- one-row-per-campaign model — unmapping now deletes the pair instead, so
-- they carry no information and are removed. Deleting a product now drops
-- its campaign pairs rather than leaving a null behind.
-- -----------------------------------------------------------------------------
delete from meta_campaign_product_mappings where product_id is null;

alter table meta_campaign_product_mappings
  drop constraint meta_campaign_product_mappings_campaign_name_key;

alter table meta_campaign_product_mappings
  drop constraint meta_campaign_product_mappings_product_id_fkey;

alter table meta_campaign_product_mappings
  alter column product_id set not null;

alter table meta_campaign_product_mappings
  add constraint meta_campaign_product_mappings_product_id_fkey
  foreign key (product_id) references products (id) on delete cascade;

alter table meta_campaign_product_mappings
  add constraint meta_campaign_product_mappings_campaign_product_key
  unique (campaign_name, product_id);
