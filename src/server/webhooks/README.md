# server/webhooks

HTTP entry points for inbound webhooks (payment provider, TikTok Shop,
Shopee, ShipMate). Not implemented yet.

Every handler added here must follow this shape:

1. Verify the request signature/secret before parsing the body.
2. Insert a row into `webhook_events` first —
   `unique (source, external_event_id)` is the idempotency guard. If the
   insert conflicts, the event was already received: acknowledge and return
   without doing any side effects.
3. Only after the insert succeeds, process the event (create/update an
   order, capture a payment, etc.), then mark the `webhook_events` row
   `processed`.
4. Wrap order/payment/inventory side effects in a single transaction (or the
   `reserve_variant_stock` / `commit_variant_stock` functions) so a crash
   mid-handler can't leave partial state.
