import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createXenditHostedPayment,
  getXenditPaymentStatus,
  isXenditSessionId,
  xenditCheckoutMode,
} from './client'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('XENDIT_SECRET_KEY_WRITE', 'write-key')
  vi.stubEnv('XENDIT_SECRET_KEY_READ', 'read-key')
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function json(body: unknown) {
  return { ok: true, json: async () => body, text: async () => '' }
}

describe('xenditCheckoutMode', () => {
  it('defaults to the legacy invoice checkout', () => {
    vi.stubEnv('XENDIT_CHECKOUT_MODE', '')
    expect(xenditCheckoutMode()).toBe('invoice')
  })

  it('switches to Payment Sessions only when set exactly', () => {
    vi.stubEnv('XENDIT_CHECKOUT_MODE', 'sessions')
    expect(xenditCheckoutMode()).toBe('sessions')
  })
})

describe('isXenditSessionId', () => {
  it('tells sessions from invoices', () => {
    expect(isXenditSessionId('ps-661f87c614802d6c402cd82d')).toBe(true)
    expect(isXenditSessionId('6929a1b2c3d4e5f6a7b8c9d0')).toBe(false)
  })
})

describe('createXenditHostedPayment', () => {
  const input = {
    referenceId: 'res-1',
    amount: 807,
    payerEmail: 'buyer@example.com',
    description: 'Spades order',
    successUrl: 'https://shop.test/ok',
    failureUrl: 'https://shop.test/fail',
    lifetimeSeconds: 300,
  }

  it('creates an invoice by default', async () => {
    vi.stubEnv('XENDIT_CHECKOUT_MODE', '')
    fetchMock.mockResolvedValue(
      json({
        id: 'inv-1',
        invoice_url: 'https://checkout.xendit.co/web/inv-1',
      }),
    )
    const result = await createXenditHostedPayment(input)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.xendit.co/v2/invoices')
    expect(result).toEqual({
      id: 'inv-1',
      url: 'https://checkout.xendit.co/web/inv-1',
    })
  })

  it('creates a PAY / PAYMENT_LINK session with at least 10 minutes', async () => {
    vi.stubEnv('XENDIT_CHECKOUT_MODE', 'sessions')
    fetchMock.mockResolvedValue(
      json({
        payment_session_id: 'ps-1',
        payment_link_url: 'https://checkout.xendit.co/sessions/ps-1',
      }),
    )
    const before = Date.now()
    const result = await createXenditHostedPayment(input)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.xendit.co/sessions')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      reference_id: 'res-1',
      session_type: 'PAY',
      mode: 'PAYMENT_LINK',
      amount: 807,
      currency: 'PHP',
      country: 'PH',
      success_return_url: 'https://shop.test/ok',
      cancel_return_url: 'https://shop.test/fail',
    })
    expect(new Date(body.expires_at).getTime() - before).toBeGreaterThanOrEqual(
      10 * 60 * 1000,
    )
    expect(result).toEqual({
      id: 'ps-1',
      url: 'https://checkout.xendit.co/sessions/ps-1',
    })
  })
})

describe('getXenditPaymentStatus', () => {
  it('reads a session and treats COMPLETED as paid', async () => {
    fetchMock.mockResolvedValue(
      json({
        payment_session_id: 'ps-1',
        status: 'COMPLETED',
        amount: 807,
        currency: 'PHP',
        payment_id: 'py-1',
      }),
    )
    const status = await getXenditPaymentStatus('ps-1')
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.xendit.co/sessions/ps-1',
    )
    expect(status).toEqual({
      id: 'ps-1',
      paid: true,
      amount: 807,
      currency: 'PHP',
      paymentId: 'py-1',
    })
  })

  it('treats an expired session as unpaid', async () => {
    fetchMock.mockResolvedValue(
      json({
        payment_session_id: 'ps-2',
        status: 'EXPIRED',
        amount: 1,
        currency: 'PHP',
      }),
    )
    expect((await getXenditPaymentStatus('ps-2')).paid).toBe(false)
  })

  it('treats a SETTLED invoice as paid', async () => {
    fetchMock.mockResolvedValue(
      json({ id: 'inv-1', status: 'SETTLED', amount: 807, currency: 'PHP' }),
    )
    const status = await getXenditPaymentStatus('inv-1')
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.xendit.co/v2/invoices/inv-1',
    )
    expect(status.paid).toBe(true)
  })
})
