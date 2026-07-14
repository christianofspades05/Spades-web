# server/orders

Server functions for order history, order detail, and order status
transitions. Not implemented yet.

Order totals are always server-computed at creation time (see
`server/checkout`) and never recalculated from client input afterward.
Status transitions (e.g. `paid` -> `processing` -> `shipped`) should be
written here as explicit functions with allowed-transition checks, not
free-form updates.
