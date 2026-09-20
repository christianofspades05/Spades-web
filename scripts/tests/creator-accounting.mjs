/** Run with CREATOR_PGLITE_MODULE pointing to an isolated @electric-sql/pglite installation. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
const { PGlite } = await import(
  process.env.CREATOR_PGLITE_MODULE ?? '@electric-sql/pglite'
)
const db = new PGlite()
const root = new URL('../../', import.meta.url)
const migration = async (name) =>
  fs.readFile(new URL(`supabase/migrations/${name}`, root), 'utf8')
await db.exec(
  `create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as 'select null::uuid';`,
)
await db.exec(
  (await migration('0001_init_schema.sql')).replace(
    'create extension if not exists "pgcrypto";',
    '',
  ),
)
for (const name of [
  '0003_collections_and_cost.sql',
  '0006_discounts_admin.sql',
  '0011_order_admin_extras.sql',
  '0059_checkout_reservations.sql',
])
  await db.exec(await migration(name))
await db.exec(
  `alter table discounts add column email_automation_id uuid; alter table orders add column brand text default 'spades'; alter table returns add column external_return_id text;`,
)
await db.exec(
  `alter table orders add column market_markup_percent numeric, add column shipping_method text default 'standard', add column lalamove_info jsonb, add column customer_notes text, add column has_pre_order_items boolean default false; alter table order_items add column is_pre_order boolean default false; alter table checkout_reservations add column shipping_method text default 'standard', add column lalamove_info jsonb, add column customer_notes text; alter table payments add column charged_currency text, add column charged_amount_cents integer; alter table orders alter column order_number set default gen_random_uuid()::text;`,
)
await db.exec(await migration('0091_creator_management.sql'))
await db.exec(await migration('0092_creator_social_platforms.sql'))
const row = async (sql, args = []) => (await db.query(sql, args)).rows[0]
async function insert(table, data) {
  const keys = Object.keys(data)
  return row(
    `insert into ${table}(${keys.join(',')}) values(${keys.map((_, i) => '$' + (i + 1)).join(',')}) returning *`,
    Object.values(data),
  )
}
const user = await insert('auth.users', { id: randomUUID() })
const staff = await insert('staff_users', {
  auth_user_id: user.id,
  full_name: 'Test admin',
  role: 'admin',
})
const managerUser = await insert('auth.users', { id: randomUUID() })
const manager = await insert('staff_users', {
  auth_user_id: managerUser.id,
  full_name: 'Manager',
  role: 'manager',
})
const customer = await insert('customers', { email: 'test@example.invalid' })
const product = await insert('products', { slug: 'test', name: 'Test' })
const variant = await insert('product_variants', {
  product_id: product.id,
  sku: 'TEST-M',
  price_cents: 100000,
  cost_cents: 30000,
})
await insert('inventory', { variant_id: variant.id, quantity_on_hand: 100 })
const discount = await insert('discounts', {
  code: 'JOHN10',
  title: 'John',
  type: 'percentage',
  value: 10,
})
const command = async (action, data, actor = staff.id) =>
  (
    await row('select creator_admin_command($1,$2,$3::jsonb) as id', [
      actor,
      action,
      JSON.stringify(data),
    ])
  ).id
const cid = await command('save_creator', {
  name: 'John',
  email: '',
  tiktokUrl: '',
  instagramUrl: '',
  facebookUrl: '',
  notes: '',
  isActive: true,
})
await command('assign_code', {
  creatorId: cid,
  discountId: discount.id,
  commissionBps: 800,
  holdDays: 14,
  brand: 'spades',
  isActive: true,
})
const state = async (id) =>
  row('select * from order_creator_attributions where order_id=$1', [id])
async function order({ age = 16, cod = false, external = null } = {}) {
  const o = await insert('orders', {
    order_number: randomUUID(),
    customer_id: customer.id,
    status: cod ? 'pending_payment' : 'paid',
    source: 'storefront',
    discount_id: discount.id,
    subtotal_cents: 200000,
    discount_cents: 20000,
    shipping_cents: 5000,
    total_cents: 185000,
    shipping_address: {},
    is_cod: cod,
    external_order_id: external,
  })
  const i = await insert('order_items', {
    order_id: o.id,
    variant_id: variant.id,
    product_name_snapshot: 'Test',
    sku_snapshot: 'TEST-M',
    unit_price_cents: 100000,
    quantity: 2,
    line_subtotal_cents: 200000,
    line_total_cents: 200000,
    charged_product_cents: 200000,
    charged_discount_cents: 20000,
    unit_cost_cents_snapshot: 30000,
  })
  await insert('payments', {
    order_id: o.id,
    provider: cod ? 'cod' : 'card',
    status: cod ? 'pending' : 'captured',
    captured_at: cod ? null : new Date().toISOString(),
    amount_cents: 185000,
    idempotency_key: randomUUID(),
  })
  const sh = await insert('shipments', {
    order_id: o.id,
    status: 'delivered',
    delivered_at: new Date(Date.now() - age * 86400000).toISOString(),
  })
  return { o, i, sh }
}
const first = await order()
assert.equal((await state(first.o.id)).earned_cents, 14400)
assert.deepEqual((await state(first.o.id)).hold_reasons, [])
for (let n = 0; n < 4; n++)
  await db.query('select reconcile_creator_order($1)', [first.o.id])
assert.equal(
  Number(
    (
      await row(
        'select count(*) as n from creator_commission_entries where order_id=$1',
        [first.o.id],
      )
    ).n,
  ),
  1,
)
console.log('PASS: John example, repeated order updates and ledger idempotency')
const young = await order({ age: 1, cod: true })
await assert.rejects(
  command('approve', { orderId: young.o.id }),
  /not eligible/,
)
await command('collect_cod', { orderId: young.o.id, reference: 'COD-1' })
assert(
  !(await state(young.o.id)).hold_reasons.includes(
    'Payment or COD collection not confirmed',
  ),
)
assert(
  (await state(young.o.id)).hold_reasons.includes(
    'Return hold period has not ended',
  ),
)
await db.query('update shipments set delivered_at=now() where id=$1', [
  first.sh.id,
])
assert((await state(first.o.id)).hold_reasons.length === 0)
console.log('PASS: COD evidence, 14-day hold and stable delivery timestamp')
await assert.rejects(
  command('approve', { orderId: first.o.id }, manager.id),
  /Administrator/,
)
await command('approve', { orderId: first.o.id })
const payout = await command('payout', {
  creatorId: cid,
  reference: 'BANK-1',
  expectedAmountCents: 14400,
})
assert.equal(
  await command('payout', {
    creatorId: cid,
    reference: 'BANK-1',
    expectedAmountCents: 14400,
  }),
  payout,
)
assert.equal((await state(first.o.id)).paid_cents, 14400)
console.log('PASS: approval authorization and duplicate payout prevention')
const refund = {
  orderId: first.o.id,
  reference: 'REF-1',
  amountCents: 45000,
  shippingCents: 0,
  taxCents: 0,
  occurredAt: new Date().toISOString(),
  items: [{ orderItemId: first.i.id, amountCents: 45000 }],
}
const rid = await command('record_refund', refund)
assert.equal(await command('record_refund', refund), rid)
assert.equal((await state(first.o.id)).earned_cents, 10800)
assert.equal((await state(first.o.id)).paid_cents, 14400)
await assert.rejects(
  command('record_refund', {
    ...refund,
    reference: 'REF-BAD',
    amountCents: 50000,
  }),
  /allocations/,
)
assert.equal((await state(first.o.id)).earned_cents, 10800)
console.log(
  'PASS: partial refund, refund retries, rollback and paid reversal balance',
)
const second = await order()
await command('approve', { orderId: second.o.id })
await command('payout', {
  creatorId: cid,
  reference: 'BANK-2',
  expectedAmountCents: 10800,
})
assert.equal((await state(first.o.id)).paid_cents, 10800)
assert.equal((await state(second.o.id)).paid_cents, 14400)
console.log('PASS: next payout offsets post-payment reversal exactly once')
const third = await order()
const ret = await insert('returns', {
  order_id: third.o.id,
  order_item_id: third.i.id,
  customer_id: customer.id,
  reason: 'Test',
  quantity: 1,
  status: 'requested',
})
await assert.rejects(
  command('approve', { orderId: third.o.id }),
  /not eligible/,
)
await command('receive_return', {
  returnId: ret.id,
  orderItemId: third.i.id,
  restock: true,
})
await command('receive_return', {
  returnId: ret.id,
  orderItemId: third.i.id,
  restock: true,
})
assert.equal((await state(third.o.id)).earned_cents, 7200)
assert.equal((await state(third.o.id)).cogs_cents, 30000)
await command('record_refund', {
  ...refund,
  orderId: third.o.id,
  reference: 'REF-RETURN',
  amountCents: 90000,
  items: [{ orderItemId: third.i.id, returnId: ret.id, amountCents: 90000 }],
})
assert.equal((await state(third.o.id)).earned_cents, 7200)
assert.equal(
  Number(
    (
      await row(
        "select count(*) n from inventory_movements where reference_type='return' and reference_id=$1",
        [ret.id],
      )
    ).n,
  ),
  1,
)
console.log(
  'PASS: partial return plus linked refund is counted once; restock is idempotent',
)
await db.query("update orders set status='cancelled' where id=$1", [third.o.id])
assert.equal((await state(third.o.id)).earned_cents, 0)
assert.equal((await state(third.o.id)).status, 'REVERSED')
console.log('PASS: cancelled orders have zero final sales and commission')
const gift = {
  id: randomUUID(),
  creatorId: cid,
  kind: 'gift',
  description: 'Content package',
  variantId: variant.id,
  quantity: 2,
  amountCents: 1,
  incurredAt: new Date().toISOString(),
  paidAt: null,
}
await command('expense', gift)
await command('expense', gift)
assert.equal(
  (
    await row('select amount_cents from creator_expenses where id=$1', [
      gift.id,
    ])
  ).amount_cents,
  60000,
)
assert.equal(
  Number(
    (
      await row(
        "select count(*) n from inventory_movements where reference_type='creator_gift' and movement_type='sale_committed'",
        [],
      )
    ).n,
  ),
  1,
)
console.log(
  'PASS: gifts use server cost, decrement stock once, and create no sales',
)
const cart = await insert('carts', {
  customer_id: customer.id,
  session_token: randomUUID(),
})
const reservation = await insert('checkout_reservations', {
  customer_id: customer.id,
  cart_id: cart.id,
  brand: 'spades',
  currency: 'PHP',
  subtotal_cents: 200000,
  discount_cents: 20000,
  shipping_cents: 5000,
  total_cents: 185000,
  discount_id: discount.id,
  shipping_address: {},
  items: [],
})
await command('assign_code', {
  creatorId: cid,
  discountId: discount.id,
  commissionBps: 1500,
  holdDays: 30,
  brand: 'spades',
  isActive: false,
})
const online = await order({ external: reservation.id })
assert.equal((await state(online.o.id)).commission_bps, 800)
assert.equal((await state(online.o.id)).hold_days, 14)
assert.equal((await state(first.o.id)).commission_bps, 800)
console.log(
  'PASS: reservation and historical attribution preserve agreed terms',
)
await db.exec('set role anon')
await assert.rejects(
  db.query('select * from creator_payouts'),
  /permission denied/,
)
await assert.rejects(
  db.query('select creator_admin_command($1,$2,$3)', [
    staff.id,
    'reconcile',
    JSON.stringify({ creatorId: cid }),
  ]),
  /permission denied/,
)
await db.exec('reset role')
console.log('PASS: anonymous table and financial RPC access denied')
await db.close()
