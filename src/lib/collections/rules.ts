import { z } from 'zod'

export const RULE_FIELDS = [
  'title',
  'product_type',
  'status',
  'tags',
  'inventory_stock',
  'price',
] as const
export type RuleField = (typeof RULE_FIELDS)[number]

export const RULE_OPERATORS = [
  'contains',
  'does_not_contain',
  'is_equal_to',
  'is_not_equal_to',
  'starts_with',
  'ends_with',
  'is_greater_than',
  'is_less_than',
] as const
export type RuleOperator = (typeof RULE_OPERATORS)[number]

/** Which operators make sense for each field — drives the operator dropdown in the rule builder. */
export const OPERATORS_BY_FIELD: Record<RuleField, RuleOperator[]> = {
  title: [
    'contains',
    'does_not_contain',
    'is_equal_to',
    'starts_with',
    'ends_with',
  ],
  product_type: ['is_equal_to', 'is_not_equal_to'],
  status: ['is_equal_to', 'is_not_equal_to'],
  tags: ['is_equal_to', 'is_not_equal_to'],
  inventory_stock: ['is_greater_than', 'is_less_than', 'is_equal_to'],
  price: ['is_greater_than', 'is_less_than', 'is_equal_to'],
}

export const collectionRuleSchema = z.object({
  field: z.enum(RULE_FIELDS),
  operator: z.enum(RULE_OPERATORS),
  value: z.string().trim().min(1).max(200),
})
export type CollectionRule = z.infer<typeof collectionRuleSchema>

/** The subset of product data a rule needs — computed once per product before evaluating rules. */
export interface RuleEvaluableProduct {
  name: string
  productType: string
  status: string
  tags: string[]
  inventoryStock: number
  lowestPriceCents: number | null
}

function matchesRule(
  product: RuleEvaluableProduct,
  rule: CollectionRule,
): boolean {
  switch (rule.field) {
    case 'title': {
      const haystack = product.name.toLowerCase()
      const needle = rule.value.toLowerCase()
      switch (rule.operator) {
        case 'contains':
          return haystack.includes(needle)
        case 'does_not_contain':
          return !haystack.includes(needle)
        case 'is_equal_to':
          return haystack === needle
        case 'starts_with':
          return haystack.startsWith(needle)
        case 'ends_with':
          return haystack.endsWith(needle)
        default:
          return false
      }
    }
    case 'product_type':
      return rule.operator === 'is_not_equal_to'
        ? product.productType !== rule.value
        : product.productType === rule.value
    case 'status':
      return rule.operator === 'is_not_equal_to'
        ? product.status !== rule.value
        : product.status === rule.value
    case 'tags':
      return rule.operator === 'is_not_equal_to'
        ? !product.tags.includes(rule.value)
        : product.tags.includes(rule.value)
    case 'inventory_stock': {
      const n = Number(rule.value)
      if (rule.operator === 'is_greater_than') return product.inventoryStock > n
      if (rule.operator === 'is_less_than') return product.inventoryStock < n
      return product.inventoryStock === n
    }
    case 'price': {
      const centsValue = Number(rule.value) * 100
      const price = product.lowestPriceCents ?? 0
      if (rule.operator === 'is_greater_than') return price > centsValue
      if (rule.operator === 'is_less_than') return price < centsValue
      return price === centsValue
    }
  }
}

/** An automated collection with zero rules matches nothing — safer default than matching the whole catalog. */
export function matchesRules(
  product: RuleEvaluableProduct,
  rules: CollectionRule[],
  matchType: 'all' | 'any',
): boolean {
  if (rules.length === 0) return false
  return matchType === 'all'
    ? rules.every((rule) => matchesRule(product, rule))
    : rules.some((rule) => matchesRule(product, rule))
}

export const SORT_OPTIONS = [
  'title_asc',
  'title_desc',
  'price_asc',
  'price_desc',
  'created_desc',
  'created_asc',
] as const
export type SortOption = (typeof SORT_OPTIONS)[number]

export const SORT_LABELS: Record<SortOption, string> = {
  title_asc: 'Title (A-Z)',
  title_desc: 'Title (Z-A)',
  price_asc: 'Price (low to high)',
  price_desc: 'Price (high to low)',
  created_desc: 'Newest first',
  created_asc: 'Oldest first',
}
