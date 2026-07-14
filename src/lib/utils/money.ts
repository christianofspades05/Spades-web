/**
 * All money is stored and computed in integer cents (centavos) to avoid
 * floating-point rounding errors. Only format to a display string at the
 * UI edge.
 */

export function pesosToCents(pesos: number): number {
  return Math.round(pesos * 100)
}

export function centsToPesos(cents: number): number {
  return cents / 100
}

export function formatCentsAsPHP(cents: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
  }).format(centsToPesos(cents))
}
