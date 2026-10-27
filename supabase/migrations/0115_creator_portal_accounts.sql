-- Lets a creator sign in to see their own code's usage and commissions.
-- Same shape as staff_users.auth_user_id: nullable until an admin creates
-- the account (see createCreatorPortalAccount), looked up only from
-- server-side code via the service-role client — creators keeps its
-- existing "no browser access" RLS lockdown from 0091_creator_management.sql,
-- so this never needs a new RLS policy.
alter table creators add column auth_user_id uuid unique references auth.users(id) on delete set null;
