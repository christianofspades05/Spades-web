import { useMemo, useRef, useState } from 'react'
import { createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import { GripVertical, Trash2 } from 'lucide-react'
import {
  getEmailAutomationById,
  updateEmailAutomation,
  createEmailImageUploadUrl,
} from '#/server/admin/email-automations'
import { createDiscount, listAllDiscounts } from '#/server/admin/discounts'
import type { EmailAutomationEventType } from '#/types/entities'
import {
  EMAIL_BLOCK_TYPES,
  EMAIL_BLOCK_TYPE_LABELS,
} from '#/lib/validation/admin/email-automations'
import { renderEmailBlocks } from '#/lib/email/blocks'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { getErrorMessage } from '#/lib/utils/errors'
import { PageHeader } from '#/components/admin/PageHeader'
import { Card } from '#/components/admin/Card'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/admin/ui'
import type { EmailBlock, EmailBlockType } from '#/types/entities'

// Standing in for a real send's actual cart/order contents — cart_items and
// order_items blocks are never editable/populated here (see BlockFields'
// note for those types), so the preview needs *something* representative
// rather than an empty gap. Mirrors the exact row markup
// api/cron/abandoned-cart.ts's renderItemsTable produces.
// Real product photos (not placeholder/broken images) so the preview reads
// as authentic — pulled from two actual active products, same size/style
// the real renderItemsTable in api/cron/abandoned-cart.ts uses (56x56,
// rounded, object-fit cover).
const SAMPLE_ITEMS_HTML = `
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    <tr>
      <td style="padding: 8px 0;">
        <img src="https://cdn.shopify.com/s/files/1/0522/4185/8747/files/SHATTERED_REALITY.jpg?v=1782833107" alt="" width="56" height="56" style="border-radius: 8px; object-fit: cover; vertical-align: middle;" />
        <span style="margin-left: 12px; font-size: 14px; color: #171717; vertical-align: middle;">
          Spades Shattered Reality Crop Polo <span style="color: #a3a3a3;">(M)</span> × 1
        </span>
      </td>
      <td style="padding: 8px 0; font-size: 14px; color: #404040; text-align: right;">₱890.00</td>
    </tr>
    <tr>
      <td style="padding: 8px 0;">
        <img src="https://cdn.shopify.com/s/files/1/0522/4185/8747/files/SAINT_NOIR.jpg?v=1782833107" alt="" width="56" height="56" style="border-radius: 8px; object-fit: cover; vertical-align: middle;" />
        <span style="margin-left: 12px; font-size: 14px; color: #171717; vertical-align: middle;">
          Spades Saint Noir Boxy Crop Polo <span style="color: #a3a3a3;">(L)</span> × 1
        </span>
      </td>
      <td style="padding: 8px 0; font-size: 14px; color: #404040; text-align: right;">₱1,590.00</td>
    </tr>
  </table>
  <p style="font-size: 15px; font-weight: 600; text-align: right; margin: 0 0 20px;">Subtotal: ₱2,480.00</p>
`

const SAMPLE_PLACEHOLDERS: Record<string, string> = {
  customerFirstName: 'Alex',
  resumeUrl: '#',
  reviewUrl: '#',
  orderNumber: 'SPD-1234',
}

export const Route = createFileRoute('/admin/email/$automationId')({
  loader: async ({ params }) => {
    const [automation, discounts] = await Promise.all([
      getEmailAutomationById({ data: { id: params.automationId } }),
      listAllDiscounts(),
    ])
    if (!automation) throw notFound()
    return { automation, discounts }
  },
  component: EmailAutomationEditorPage,
})

function emptyBlock(type: EmailBlockType): EmailBlock {
  return { type }
}

// Just a starting suggestion staff can edit before creating — not
// guaranteed unique, createDiscount will reject a real collision.
const SUGGESTED_DISCOUNT_CODE: Record<EmailAutomationEventType, string> = {
  welcome: 'WELCOME10',
  abandoned_cart: 'COMEBACK10',
  post_purchase_review: 'REVIEW10',
  birthday: 'BDAY15',
}

function EmailAutomationEditorPage() {
  const { automation, discounts } = Route.useLoaderData()
  const router = useRouter()

  const [name, setName] = useState(automation.name)
  const [isActive, setIsActive] = useState(automation.is_active)
  const [subject, setSubject] = useState(automation.subject)
  const [localDiscounts, setLocalDiscounts] = useState(discounts)
  const [discountId, setDiscountId] = useState(automation.discount_id ?? '')
  const [delayHours, setDelayHours] = useState(automation.delay_hours)
  const [blocks, setBlocks] = useState<EmailBlock[]>(automation.blocks)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [creatingDiscount, setCreatingDiscount] = useState(false)
  const [newDiscountCode, setNewDiscountCode] = useState(
    SUGGESTED_DISCOUNT_CODE[automation.event_type],
  )
  const [newDiscountPercent, setNewDiscountPercent] = useState(10)
  const [savingNewDiscount, setSavingNewDiscount] = useState(false)
  const [newDiscountError, setNewDiscountError] = useState<string | null>(null)

  // Live re-render on every block/discount edit — a sample recipient's cart
  // and a made-up per-recipient code, not real data (see mint-discount.ts's
  // doc comment for why a real send never reuses one code across
  // customers; this preview intentionally fakes that one code for display).
  const selectedDiscount = localDiscounts.find((d) => d.id === discountId)
  const previewHtml = useMemo(
    () =>
      renderEmailBlocks(blocks, {
        itemsHtml: SAMPLE_ITEMS_HTML,
        placeholders: SAMPLE_PLACEHOLDERS,
        discount: selectedDiscount
          ? {
              code: `${selectedDiscount.code ?? 'CODE'}-A1B2C3`,
              type: selectedDiscount.type,
              value: selectedDiscount.value,
              // Only abandoned-cart codes ever actually expire (see
              // mint-discount.ts's expiresInDays) — sample a 3-day-out
              // date here so the preview matches a real send, but only
              // for the one event type that's ever true for.
              endsAt:
                automation.event_type === 'abandoned_cart'
                  ? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
                  : null,
            }
          : null,
        unsubscribeUrl: '#',
      }),
    [blocks, selectedDiscount],
  )

  async function handleCreateDiscount(event: React.FormEvent) {
    event.preventDefault()
    setSavingNewDiscount(true)
    setNewDiscountError(null)
    try {
      const discount = await createDiscount({
        data: {
          kind: 'code',
          scope: 'all',
          title: `${name} discount`,
          code: newDiscountCode,
          discountType: 'percentage',
          percentageValue: newDiscountPercent,
          oneUsePerCustomer: true,
          isActive: true,
          excludedCollectionIds: [],
          includedCollectionIds: [],
        },
      })
      setLocalDiscounts((prev) => [discount, ...prev])
      setDiscountId(discount.id)
      setCreatingDiscount(false)
    } catch (err) {
      setNewDiscountError(getErrorMessage(err))
    } finally {
      setSavingNewDiscount(false)
    }
  }

  const dragIndex = useRef<number | null>(null)

  const isDelayBased =
    automation.event_type === 'abandoned_cart' ||
    automation.event_type === 'post_purchase_review'

  function updateBlock(index: number, patch: Partial<EmailBlock>) {
    setBlocks((prev) =>
      prev.map((b, i) => (i === index ? { ...b, ...patch } : b)),
    )
  }

  function removeBlock(index: number) {
    setBlocks((prev) => prev.filter((_, i) => i !== index))
  }

  function addBlock(type: EmailBlockType) {
    setBlocks((prev) => [...prev, emptyBlock(type)])
  }

  function handleDragStart(index: number) {
    dragIndex.current = index
  }

  function handleDragOver(event: React.DragEvent, overIndex: number) {
    event.preventDefault()
    const from = dragIndex.current
    if (from === null || from === overIndex) return
    setBlocks((prev) => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(overIndex, 0, moved)
      return next
    })
    dragIndex.current = overIndex
  }

  function handleDragEnd() {
    dragIndex.current = null
  }

  async function handleSave() {
    setSubmitting(true)
    setError(null)
    try {
      await updateEmailAutomation({
        data: {
          id: automation.id,
          name,
          isActive,
          subject,
          blocks,
          discountId: discountId || null,
          delayHours,
        },
      })
      await router.invalidate()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader title={automation.name} subtitle="Edit this automation" />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="w-full max-w-2xl">
          <Card className="mb-6 flex flex-col gap-4 p-5">
            <label className={labelClassName}>
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClassName}
              />
            </label>

            <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Active
            </label>

            <label className={labelClassName}>
              Subject
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className={inputClassName}
              />
            </label>

            <label className={labelClassName}>
              Discount template (optional)
              <select
                value={discountId}
                onChange={(e) => setDiscountId(e.target.value)}
                className={inputClassName}
              >
                <option value="">No discount</option>
                {localDiscounts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title} {d.code ? `(${d.code})` : ''}
                  </option>
                ))}
              </select>
              <span className="text-xs font-normal text-neutral-400">
                Not sent directly — each customer gets their own single-use code
                cloned from this template's type and value at send time, so no
                two customers ever receive the same redeemable code.
              </span>
            </label>

            {!creatingDiscount ? (
              <button
                type="button"
                onClick={() => setCreatingDiscount(true)}
                className={`${buttonSecondaryClassName} w-fit`}
              >
                + Create new discount template for this automation
              </button>
            ) : (
              <form
                onSubmit={handleCreateDiscount}
                className="flex flex-col gap-3 rounded-md border border-neutral-200 p-3"
              >
                <div className="flex gap-3">
                  <label className={`${labelClassName} flex-1`}>
                    Code
                    <input
                      required
                      value={newDiscountCode}
                      onChange={(e) =>
                        setNewDiscountCode(e.target.value.toUpperCase())
                      }
                      className={inputClassName}
                    />
                  </label>
                  <label className={labelClassName}>
                    % off
                    <input
                      type="number"
                      required
                      min={1}
                      max={100}
                      value={newDiscountPercent}
                      onChange={(e) =>
                        setNewDiscountPercent(Number(e.target.value))
                      }
                      className={`${inputClassName} w-24`}
                    />
                  </label>
                </div>
                {newDiscountError && (
                  <p className="text-sm text-red-600">{newDiscountError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={savingNewDiscount}
                    className={buttonPrimaryClassName}
                  >
                    {savingNewDiscount ? 'Creating…' : 'Create and attach'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreatingDiscount(false)}
                    className={buttonSecondaryClassName}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {isDelayBased && (
              <label className={labelClassName}>
                Send this many hours after the trigger (e.g. 0.5 = 30 min)
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={delayHours}
                  onChange={(e) => setDelayHours(Number(e.target.value))}
                  className={inputClassName}
                />
              </label>
            )}
          </Card>

          <p className="mb-2 text-xs font-semibold tracking-wider text-neutral-400 uppercase">
            Content
          </p>

          <div className="mb-4 flex flex-col gap-3">
            {blocks.map((block, index) => (
              <div
                key={index}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
              >
                <Card className="flex items-start gap-3 p-4">
                  <GripVertical
                    size={16}
                    className="mt-2 shrink-0 cursor-grab text-neutral-300"
                  />
                  <div className="flex-1">
                    <BlockFields
                      block={block}
                      onChange={(patch) => updateBlock(index, patch)}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeBlock(index)}
                    className="shrink-0 text-neutral-400 hover:text-red-600"
                  >
                    <Trash2 size={16} />
                  </button>
                </Card>
              </div>
            ))}
            {blocks.length === 0 && (
              <p className="rounded-xl border border-dashed border-neutral-200 bg-white p-6 text-center text-sm text-neutral-400">
                No content blocks yet — add one below.
              </p>
            )}
          </div>

          <div className="mb-8 flex flex-wrap gap-2">
            {EMAIL_BLOCK_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => addBlock(type)}
                className={buttonSecondaryClassName}
              >
                + {EMAIL_BLOCK_TYPE_LABELS[type]}
              </button>
            ))}
          </div>

          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

          <button
            type="button"
            disabled={submitting}
            onClick={handleSave}
            className={buttonPrimaryClassName}
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>

        <div className="w-full lg:sticky lg:top-6 lg:w-[400px] lg:shrink-0">
          <p className="mb-2 text-xs font-semibold tracking-wider text-neutral-400 uppercase">
            Preview
          </p>
          <Card className="overflow-hidden p-0">
            <div className="space-y-1 border-b border-neutral-100 bg-white px-4 py-3">
              <p className="truncate text-sm font-semibold text-neutral-900">
                {subject || (
                  <span className="font-normal text-neutral-400">
                    (no subject)
                  </span>
                )}
              </p>
              <p className="text-xs text-neutral-500">
                <span className="font-medium text-neutral-700">Spades</span>{' '}
                &lt;hello@spadesclothingbrand.com&gt;
              </p>
              <p className="text-xs text-neutral-400">To: alex@example.com</p>
            </div>
            <iframe
              title="Email preview"
              srcDoc={`<!doctype html><html><body style="margin:0; padding:24px 12px; background:#f2f2f2;"><div style="max-width:520px; margin:0 auto; background:#ffffff; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,0.08);">${previewHtml}</div></body></html>`}
              className="h-[600px] w-full"
            />
          </Card>
          <p className="mt-2 text-xs text-neutral-400">
            Sample data — a real send fills in the actual customer's items,
            code, and links.
          </p>
        </div>
      </div>
    </div>
  )
}

function BlockFields({
  block,
  onChange,
}: {
  block: EmailBlock
  onChange: (patch: Partial<EmailBlock>) => void
}) {
  const [uploading, setUploading] = useState(false)

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const { path, token, publicUrl } = await createEmailImageUploadUrl({
        data: { fileName: file.name },
      })
      const { error } = await getSupabaseBrowserClient()
        .storage.from('email-images')
        .uploadToSignedUrl(path, token, file)
      if (error) throw error
      onChange({ imageUrl: publicUrl })
    } finally {
      setUploading(false)
    }
  }

  if (block.type === 'header_image') {
    return (
      <label className={labelClassName}>
        {EMAIL_BLOCK_TYPE_LABELS[block.type]}
        <input
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className={inputClassName}
        />
        {uploading && (
          <span className="text-xs font-normal text-neutral-500">
            Uploading…
          </span>
        )}
        {block.imageUrl && !uploading && (
          <img
            src={block.imageUrl}
            alt=""
            className="mt-1 h-20 w-full rounded-md border border-neutral-200 object-cover"
          />
        )}
      </label>
    )
  }

  if (block.type === 'heading' || block.type === 'text') {
    return (
      <label className={labelClassName}>
        {EMAIL_BLOCK_TYPE_LABELS[block.type]}
        <textarea
          value={block.text ?? ''}
          onChange={(e) => onChange({ text: e.target.value })}
          rows={block.type === 'heading' ? 1 : 3}
          className={inputClassName}
        />
      </label>
    )
  }

  if (block.type === 'button') {
    return (
      <div className="flex flex-col gap-2">
        <label className={labelClassName}>
          Button label
          <input
            value={block.buttonLabel ?? ''}
            onChange={(e) => onChange({ buttonLabel: e.target.value })}
            className={inputClassName}
          />
        </label>
        <label className={labelClassName}>
          Button URL
          <input
            value={block.buttonUrl ?? ''}
            onChange={(e) => onChange({ buttonUrl: e.target.value })}
            className={inputClassName}
          />
        </label>
      </div>
    )
  }

  if (block.type === 'discount_code') {
    return (
      <p className="text-sm text-neutral-500">
        Shows this customer's own single-use code, cloned from the discount
        template above — only appears once a template is attached.
      </p>
    )
  }

  if (block.type === 'cart_items' || block.type === 'order_items') {
    return (
      <p className="text-sm text-neutral-500">
        {block.type === 'cart_items'
          ? "Shows this customer's actual cart contents — different for every send, not editable here."
          : "Shows this customer's actual order items — different for every send, not editable here."}
      </p>
    )
  }

  return (
    <p className="text-sm text-neutral-500">
      Store footer with an unsubscribe link — always included, not editable.
    </p>
  )
}
