-- Selfie verification for self clock-ins. Staff take a live camera photo
-- (in the store) when they clock in; the owner sees it on the Team page.
--
-- Private bucket, no storage RLS policies: uploads go through a signed
-- upload URL minted by the server (createClockInPhotoUpload in
-- src/server/admin/attendance.ts) for the caller's own employee folder, and
-- the owner views photos through short-lived signed URLs. Nothing is
-- publicly readable.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attendance-photos', 'attendance-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

-- Path inside attendance-photos ({employee_id}/{date}/{uuid}.jpg). Null for
-- owner-entered (manual) shifts and for shifts from before this feature.
alter table attendance_logs add column clock_in_photo_path text;
