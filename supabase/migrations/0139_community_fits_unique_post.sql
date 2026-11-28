-- One Community Fit per Instagram post. Links are saved in canonical form
-- (https://www.instagram.com/p/CODE/ or /reel/CODE/ — see
-- normalizeInstagramPostUrl), and a /p/ and /reel/ link with the same CODE
-- are the same post, so uniqueness is on the shortcode itself. The admin
-- server function checks this first and shows a friendly message; this
-- index is the backstop for two staff adding the same post at once.
create unique index community_fits_instagram_shortcode_key
  on community_fits ((substring(instagram_url from '/(?:p|reel)/([A-Za-z0-9_-]+)')));
