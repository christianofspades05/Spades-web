/**
 * Renders an email_automations.blocks array (see types/entities.ts's
 * EmailBlock) into the HTML body of an email. Shared by every cron route
 * that sends a staff-configurable lifecycle email (abandoned-cart,
 * review-request, and future welcome/birthday) — the wrapper content
 * (header image, heading, text, button, discount code, footer) is fully
 * staff-editable via the admin "Email" page; the per-recipient dynamic
 * parts (a cart's or order's actual item list) are computed by the caller
 * and injected via `itemsHtml`, since they vary per send and are never
 * stored on the automation itself.
 */
import { formatCentsAsPHP } from '#/lib/utils/money'
import type { DiscountType } from '#/types/entities'
import type { EmailBlock } from '#/types/entities'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface EmailDiscountInfo {
  code: string | null
  type: DiscountType
  value: number
}

export interface EmailRenderContext {
  /** Pre-built HTML for this event's per-recipient item list — rendered
   *  wherever a cart_items/order_items block is positioned. */
  itemsHtml?: string
  /** Replaces `{{key}}` tokens with real, per-recipient values (e.g.
   *  `{{resumeUrl}}`, `{{reviewUrl}}`, `{{customerFirstName}}`) — substituted
   *  into both a button block's URL and heading/text content, so a
   *  personalized greeting ("Hi {{customerFirstName}},") survives moving
   *  from a hardcoded template into staff-editable text. The editor only
   *  ever stores the token, never a real per-recipient value. */
  placeholders?: Record<string, string>
  discount?: EmailDiscountInfo | null
  unsubscribeUrl?: string
}

function substitutePlaceholders(
  value: string,
  placeholders: Record<string, string>,
): string {
  return value.replace(/\{\{(\w+)\}\}/g, (_match, key: string) =>
    Object.prototype.hasOwnProperty.call(placeholders, key)
      ? placeholders[key]
      : '',
  )
}

function discountLabel(discount: EmailDiscountInfo): string {
  const value =
    discount.type === 'percentage'
      ? `${discount.value}% off`
      : discount.type === 'fixed_amount'
        ? `${formatCentsAsPHP(discount.value)} off`
        : 'Free shipping'
  return discount.code ? `${value} — use code ${discount.code}` : value
}

function renderBlock(block: EmailBlock, context: EmailRenderContext): string {
  switch (block.type) {
    case 'header_image':
      return block.imageUrl
        ? `<img src="${escapeHtml(block.imageUrl)}" alt="" style="width: 100%; border-radius: 8px; display: block;" />`
        : ''
    case 'heading': {
      if (!block.text) return ''
      const text = substitutePlaceholders(
        block.text,
        context.placeholders ?? {},
      )
      return `<p style="font-size: 16px; font-weight: 600; color: #171717;">${escapeHtml(text)}</p>`
    }
    case 'text': {
      if (!block.text) return ''
      const text = substitutePlaceholders(
        block.text,
        context.placeholders ?? {},
      )
      return `<p style="font-size: 15px; line-height: 1.6; color: #404040;">${escapeHtml(text)}</p>`
    }
    case 'button': {
      if (!block.buttonLabel || !block.buttonUrl) return ''
      const url = substitutePlaceholders(
        block.buttonUrl,
        context.placeholders ?? {},
      )
      return `<a href="${escapeHtml(url)}" style="display: inline-block; background: #0a0a0a; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 24px; border-radius: 999px; margin: 8px 0;">${escapeHtml(block.buttonLabel)}</a>`
    }
    case 'discount_code':
      return context.discount
        ? `<p style="font-size: 14px; font-weight: 600; color: #171717; background: #f5f5f5; border-radius: 8px; padding: 12px 16px; text-align: center;">${escapeHtml(discountLabel(context.discount))}</p>`
        : ''
    case 'cart_items':
    case 'order_items':
      return context.itemsHtml ?? ''
    case 'footer':
      return context.unsubscribeUrl
        ? `<p style="font-size: 12px; color: #a3a3a3; margin-top: 32px;"><a href="${escapeHtml(context.unsubscribeUrl)}" style="color: #a3a3a3;">Unsubscribe</a> from these emails.</p>`
        : ''
    default:
      return ''
  }
}

export function renderEmailBlocks(
  blocks: EmailBlock[],
  context: EmailRenderContext = {},
): string {
  const body = blocks
    .map((block) => renderBlock(block, context))
    .filter(Boolean)
    .join('\n')
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 20px; color: #171717;">${body}</div>`
}
