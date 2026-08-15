-- Powers the admin nav's reply-notification bell (Admin > any page > sidebar)
-- — null means an inbound (customer reply) message hasn't been seen by
-- staff yet. Set when staff open that order's Emails card
-- (listOrderEmailMessages marks every unread inbound row for that order as
-- read as a side effect). Outbound rows never have this checked.
alter table order_email_messages
  add column read_at timestamptz;
