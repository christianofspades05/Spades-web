/** Allocate whole centavos exactly. Largest remainders win; ties use input order. */
export function allocateCents(total: number, weights: number[]): number[] {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    weights.some((n) => !Number.isSafeInteger(n) || n < 0)
  ) {
    throw new Error('Amounts must be nonnegative integer centavos')
  }
  const sum = weights.reduce((a, b) => a + b, 0)
  if (!Number.isSafeInteger(sum))
    throw new Error('Amount exceeds safe precision')
  if (!sum) {
    if (total)
      throw new Error('Cannot allocate an amount without eligible products')
    return weights.map(() => 0)
  }
  const denominator = BigInt(sum)
  const numerators = weights.map((w) => BigInt(w) * BigInt(total))
  const result = numerators.map((n) => Number(n / denominator))
  const ranked = numerators
    .map((n, i) => ({ i, remainder: n % denominator }))
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.i - b.i
        : a.remainder > b.remainder
          ? -1
          : 1,
    )
  const remaining = total - result.reduce((a, b) => a + b, 0)
  for (let i = 0; i < remaining; i++) result[ranked[i].i]++
  return result
}

/** New financial snapshots preserve charged markup without changing legacy line fields. */
export function chargedItemAmounts(
  subtotal: number,
  discount: number,
  items: { subtotal: number; discount: number }[],
) {
  const gross = allocateCents(
    subtotal,
    items.map((i) => i.subtotal),
  )
  const reductions = allocateCents(
    discount,
    items.map((i) => i.discount),
  )
  return gross.map((amount, i) => {
    if (reductions[i] > amount)
      throw new Error('Product discount exceeds its charged price')
    return { chargedProductCents: amount, chargedDiscountCents: reductions[i] }
  })
}
