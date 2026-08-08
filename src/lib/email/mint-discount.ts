/**
 * Mints a fresh, single-use discount code cloned from a "template" discount
 * for one specific email recipient — used by every lifecycle automation
 * send path (abandoned-cart, review-requests, birthday, welcome-email
 * crons). Each of those automations only ever emails one specific customer
 * per trigger (there's no broadcast/campaign concept here), so handing out
 * the *same* code to every recipient would let anyone who saw the email
 * reuse — or publicly leak — a code meant for someone else. The discount an
 * automation has attached (via email_automations.discount_id) is never
 * emailed directly; only its type/value gets cloned into a brand-new
 * max_uses: 1 code per send. See 0037_discount_per_recipient_codes.sql for
 * the email_automation_id column this tags each clone with, which is what
 * the admin Email page's attribution stats sum over.
 *
 * `options.expiresInDays`, when passed, sets ends_at that many days out
 * from mint time — omitted (the default for every automation except
 * abandoned-cart), the minted code never expires.
 */
import { randomBytes } from 'node:crypto'
import type { getSupabaseAdminClient } from '#/lib/supabase/admin'

export interface MintedDiscount {
  id: string
  code: string
  type: 'percentage' | 'fixed_amount' | 'free_shipping'
  value: number
  endsAt: string | null
}

function randomCodeSuffix(): string {
  return randomBytes(3).toString('hex').toUpperCase()
}

export async function mintPerRecipientDiscount(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  templateDiscountId: string,
  automationId: string,
  options?: { expiresInDays?: number },
): Promise<MintedDiscount | null> {
  const { data: template, error } = await admin
    .from('discounts')
    .select('title, type, value, max_discounted_items, excludes_free_shipping')
    .eq('id', templateDiscountId)
    .maybeSingle()
  if (error) throw error
  if (!template) return null

  const codeBase =
    template.title
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 12) || 'SAVE'
  const code = `${codeBase}-${randomCodeSuffix()}`
  const endsAt = options?.expiresInDays
    ? new Date(
        Date.now() + options.expiresInDays * 24 * 60 * 60 * 1000,
      ).toISOString()
    : null

  const { data: minted, error: insertError } = await admin
    .from('discounts')
    .insert({
      kind: 'code',
      scope: 'all',
      title: template.title,
      code,
      type: template.type,
      value: template.value,
      max_discounted_items: template.max_discounted_items,
      excludes_free_shipping: template.excludes_free_shipping,
      // Whether this code stacks with an active store-wide sale is decided
      // by the sale's own setting, not the code's — see
      // resolveDiscountForCart. Nothing to copy from the template here.
      max_uses: 1,
      max_uses_per_customer: 1,
      is_active: true,
      email_automation_id: automationId,
      ends_at: endsAt,
    })
    .select('id, code, type, value, ends_at')
    .single()
  if (insertError) throw insertError
  // discounts.code is nullable at the schema level (an 'automatic' kind
  // discount has none), but this insert always sets kind: 'code' with a
  // real code above, so a null here would mean the insert didn't round-trip
  // what was just sent — a bug worth surfacing loudly, not masking.
  if (!minted.code) {
    throw new Error('Minted discount was inserted without a code')
  }
  return { ...minted, code: minted.code, endsAt: minted.ends_at }
}
