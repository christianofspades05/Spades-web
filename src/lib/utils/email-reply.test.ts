import { describe, it, expect } from 'vitest'
import { stripQuotedReply } from './email-reply'

describe('stripQuotedReply', () => {
  it('does not cut off a short reply whose own text happens to contain "on" mid-word', () => {
    // Real live bug: "Pasong tamo po" got cut down to "Pas" because the
    // case-insensitive `on` matched inside "Pasong" itself, and the lazy
    // [\s\S]{0,400}? reached the genuine quote header further down in the
    // same message.
    const text =
      'Pasong tamo po\n\n' +
      'On Fri, Sep 25, 2026 at 3:14 PM Spades Official <order-abc@reply.spades-official.com> wrote:\n' +
      '> Hi, is it Pasong Tamo or Veterans Village po?\n'
    expect(stripQuotedReply(text)).toBe('Pasong tamo po')
  })

  it('strips a normal single-line "On ... wrote:" header', () => {
    const text =
      'Yes I received it already, thank you!\n\n' +
      'On Mon, Sep 22, 2026 at 9:00 AM Spades Official <orders@spades-official.com> wrote:\n' +
      '> We couldn\'t deliver order SPD-8999\n'
    expect(stripQuotedReply(text)).toBe('Yes I received it already, thank you!')
  })

  it('strips a header that hard-wraps across multiple lines before "wrote:"', () => {
    const text =
      'Okay po, salamat!\n\n' +
      'On Mon, Sep 22, 2026 at 9:00 AM Spades Official Orders\n' +
      '<orders@spades-official.com>\n' +
      'wrote:\n' +
      '> your message\n'
    expect(stripQuotedReply(text)).toBe('Okay po, salamat!')
  })

  it('strips an Outlook-style "-----Original Message-----" separator', () => {
    const text =
      'Please cancel my order.\n\n' +
      '-----Original Message-----\n' +
      'From: orders@spades-official.com\n'
    expect(stripQuotedReply(text)).toBe('Please cancel my order.')
  })

  it('drops trailing \'>\'-quoted lines even with no header at all', () => {
    const text = 'Got it, thanks!\n> some quoted line\n> another quoted line'
    expect(stripQuotedReply(text)).toBe('Got it, thanks!')
  })

  it('leaves a reply that starts with a real "On ..." sentence untouched when there is no quote header', () => {
    const text = 'On the way to deliver it now, should arrive today.'
    expect(stripQuotedReply(text)).toBe(text)
  })

  it('returns the whole text untouched when nothing matches', () => {
    const text = 'Hindi ko pa natatanggap yung order ko.'
    expect(stripQuotedReply(text)).toBe(text)
  })
})
