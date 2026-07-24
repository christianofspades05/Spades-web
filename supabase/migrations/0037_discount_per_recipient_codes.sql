-- Every lifecycle automation (welcome/abandoned_cart/post_purchase_review/
-- birthday) only ever sends to one specific customer per trigger — there's
-- no broadcast/campaign concept here — so a discount attached to one should
-- never be handed out as a single shared code: that lets any recipient use
-- (or worse, publicly leak) a code meant for someone else. The discount
-- picked/created in the automation editor is now treated purely as a
-- template (its type + value); at actual send time, a fresh single-use
-- discount is cloned from it per recipient. This column tracks which
-- automation minted a given clone, for both bookkeeping and attribution
-- stats (see server/admin/email-automations.ts).
alter table discounts add column email_automation_id uuid references email_automations (id) on delete set null;
create index discounts_email_automation_id_idx on discounts (email_automation_id);
