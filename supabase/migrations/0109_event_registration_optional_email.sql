-- Staff manually adding a registrant (walk-in, comped, etc. — see
-- addEventRegistration in src/server/admin/events.ts) may not have an
-- email on hand. The public self-registration flow (registerForEvent)
-- still always requires one at the application layer, since it's needed
-- for the Xendit payment receipt/confirmation email — this just lets the
-- column itself hold null for the admin-only path.
alter table event_registrations alter column email drop not null;
