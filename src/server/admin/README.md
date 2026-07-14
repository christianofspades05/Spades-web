# server/admin

Server functions backing the admin dashboard: products, variants,
collections, inventory adjustments, orders, customers, discounts, returns,
analytics, staff account management, activity log queries. Not implemented
yet.

Every function in this domain must call `requireStaff([...allowedRoles])`
from `lib/auth/guards.ts` before touching the admin Supabase client, and
should write an `activity_logs` row for any mutation (who did what, to
which entity).
