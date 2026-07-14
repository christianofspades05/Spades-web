# integrations/profitmate

Not implemented yet.

Planned scope: read-only export/API of revenue, fees, discounts, refunds,
and COGS-relevant data (`orders`, `order_items`, `payments`, `returns`,
`discounts`) for ProfitMate's profitability analytics. Likely a scheduled
export or a signed read endpoint rather than direct DB access, so
ProfitMate never needs write access to the storefront database.
