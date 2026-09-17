import type { CreatorAttribution, CreatorExpense } from '#/types/creators'

export function creatorTotals(
  orders: CreatorAttribution[],
  expenses: CreatorExpense[],
) {
  const sales = orders.reduce((s, o) => s + o.product_revenue_cents, 0)
  const earned = orders.reduce((s, o) => s + o.earned_cents, 0)
  const costs = orders.reduce((s, o) => s + o.cogs_cents, 0)
  const expenseTotal = expenses.reduce((s, e) => s + e.amount_cents, 0)
  const approved = orders
    .filter((o) => o.status === 'APPROVED')
    .reduce((s, o) => s + Math.max(0, o.earned_cents - o.paid_cents), 0)
  const recovery = orders.reduce(
    (s, o) => s + Math.max(0, o.paid_cents - o.earned_cents),
    0,
  )
  return {
    orders: orders.length,
    sales,
    earned,
    costs,
    expenseTotal,
    approved,
    recovery,
    payable: Math.max(0, approved - recovery),
    pending: orders
      .filter((o) => o.status === 'PENDING')
      .reduce((s, o) => s + Math.max(0, o.earned_cents - o.paid_cents), 0),
    paid: orders.reduce((s, o) => s + o.paid_cents, 0),
    finalizedSales: orders
      .filter((o) => o.status === 'APPROVED' || o.status === 'PAID')
      .reduce((s, o) => s + o.product_revenue_cents, 0),
    contribution: sales - earned - costs - expenseTotal,
    missingCosts: orders.some((o) => o.missing_cost),
  }
}
