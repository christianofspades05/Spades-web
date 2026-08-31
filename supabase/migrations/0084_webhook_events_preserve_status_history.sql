-- webhook_events was uniqued on (source, external_event_id) alone, but
-- external_event_id is the payment provider's own invoice/transaction id —
-- the SAME id across every lifecycle event for that invoice (e.g. Xendit
-- sends EXPIRED and PAID webhooks for the same invoice id when its own
-- expiry sweep races its payment-settlement pipeline). The old constraint
-- meant a later event's upsert silently overwrote an earlier one's row,
-- erasing any evidence that the earlier event ever arrived — exactly the
-- kind of history needed to debug a lost order. Widening the key to
-- include event_type keeps each lifecycle transition as its own row.
alter table webhook_events drop constraint webhook_events_source_external_event_id_key;
alter table webhook_events add constraint webhook_events_source_external_event_id_event_type_key
  unique (source, external_event_id, event_type);
