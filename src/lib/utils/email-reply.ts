/**
 * Strips the quoted original message every mail client appends below a
 * reply (Gmail/Apple Mail's "On <date> ... wrote:" header plus the
 * '>'-prefixed lines that follow, or Outlook's "-----Original Message-----"
 * separator) — used to show only what the customer actually typed in the
 * order-emails thread (src/routes/admin/orders/$orderId.tsx), not their
 * whole reply chain re-quoted back at us. Applied at display time (not
 * ingestion) so improving this heuristic later re-cleans already-stored
 * messages for free, with no backfill needed.
 */
export function stripQuotedReply(text: string): string {
  // The "On ... wrote:" header commonly hard-wraps across multiple lines
  // (a long display name/email pushes "wrote:" onto its own line), so this
  // matches across newlines rather than requiring it all on one line.
  // Anchored to a real line start (`^` or right after `\n`), not a bare
  // substring — confirmed live: a reply of just "Pasong tamo po" was cut
  // down to "Pas", because the case-insensitive `on` matched inside
  // "Pasong" itself and the lazy `[\s\S]{0,400}?` had no trouble reaching
  // the genuine "On <date> ... wrote:" header further down in the same
  // message. Real quote headers always start their own line and are
  // followed by whitespace, never mid-word.
  const headerMatch = /(?:^|\n)On\s[\s\S]{0,400}?wrote:[ \t]*\n/i.exec(text)
  let cleaned = headerMatch ? text.slice(0, headerMatch.index) : text

  const outlookIdx = cleaned.indexOf('-----Original Message-----')
  if (outlookIdx !== -1) cleaned = cleaned.slice(0, outlookIdx)

  // Belt-and-braces: drop any trailing run of '>'-quoted lines even when no
  // header above matched (some clients quote without one).
  const lines = cleaned.split('\n')
  while (lines.length > 0 && /^\s*>/.test(lines[lines.length - 1])) {
    lines.pop()
  }

  return lines.join('\n').trim()
}
