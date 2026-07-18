import { useState } from 'react'
import { z } from 'zod'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Download, Search } from 'lucide-react'
import { listCustomers } from '#/server/admin/customers'
import type { CustomerListRow } from '#/server/admin/customers'
import { PageHeader } from '#/components/admin/PageHeader'
import { Badge } from '#/components/admin/Badge'
import { CustomerCard } from '#/components/admin/CustomerCard'
import { FilterDropdown } from '#/components/admin/FilterDropdown'
import {
  buttonSecondaryClassName,
  inputClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

const CHANNEL_OPTIONS = [
  { value: 'storefront', label: 'Online Store' },
  { value: 'tiktok_shop', label: 'TikTok Shop' },
  { value: 'shopee', label: 'Shopee' },
  { value: 'lazada', label: 'Lazada' },
] as const

export const Route = createFileRoute('/admin/customers/')({
  validateSearch: z.object({
    q: z.string().optional(),
    source: z
      .enum(['storefront', 'admin', 'tiktok_shop', 'shopee', 'lazada'])
      .optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) =>
    listCustomers({ data: { q: deps.q, source: deps.source } }),
  component: CustomersPage,
})

/** Quotes a CSV field per RFC 4180 — wraps in double quotes and escapes any embedded quotes whenever the value itself contains a comma, quote, or newline. */
function csvField(value: string | number | boolean | null): string {
  const str = value === null ? '' : String(value)
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

function downloadCustomersCsv(customers: CustomerListRow[]) {
  const headers = [
    'Name',
    'Email',
    'Phone',
    'Orders',
    'Cancelled',
    'Returns',
    'Guest',
    'High risk',
    'COD blocked',
  ]
  const rows = customers.map((c) =>
    [
      csvField(c.full_name),
      csvField(c.email),
      csvField(c.phone),
      csvField(c.orders_count),
      csvField(c.cancelled_orders_count),
      csvField(c.return_count),
      csvField(c.is_guest),
      csvField(c.is_high_risk),
      csvField(c.cod_blocked),
    ].join(','),
  )
  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function CustomersPage() {
  const customers: CustomerListRow[] = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [searchInput, setSearchInput] = useState(search.q ?? '')

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault()
    navigate({
      search: (prev) => ({ ...prev, q: searchInput || undefined }),
    })
  }

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Customers"
        subtitle={`${customers.length} ${customers.length === 1 ? 'customer' : 'customers'}`}
        action={
          <button
            type="button"
            onClick={() => downloadCustomersCsv(customers)}
            disabled={customers.length === 0}
            className={`${buttonSecondaryClassName} inline-flex items-center gap-1.5 disabled:opacity-50`}
          >
            <Download size={14} />
            Export CSV
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form onSubmit={handleSearchSubmit} className="w-full max-w-xs">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-neutral-400"
            />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name, email, or phone"
              className={`${inputClassName} w-full pl-8`}
            />
          </div>
        </form>
        <FilterDropdown
          label="Channel"
          value={search.source}
          options={CHANNEL_OPTIONS}
          onChange={(source) =>
            navigate({ search: (prev) => ({ ...prev, source }) })
          }
        />
      </div>

      {customers.length === 0 && (
        <p className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
          No customers found.
        </p>
      )}

      {customers.length > 0 && (
        <div className="flex flex-col gap-3 md:hidden">
          {customers.map((customer) => (
            <CustomerCard
              key={customer.id}
              customer={customer}
              onOpen={() =>
                navigate({
                  to: '/admin/customers/$customerId',
                  params: { customerId: customer.id },
                })
              }
            />
          ))}
        </div>
      )}

      <div className={`${tableWrapperClassName} hidden md:block`}>
        {customers.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">No customers found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={tableHeadClassName}>Customer</th>
                  <th className={tableHeadClassName}>Contact</th>
                  <th className={`${tableHeadClassName} text-right`}>Orders</th>
                  <th className={`${tableHeadClassName} text-right`}>
                    Cancelled
                  </th>
                  <th className={`${tableHeadClassName} text-right`}>
                    Returns
                  </th>
                  <th className={tableHeadClassName}>Risk</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id} className={tableRowClassName}>
                    <td className={tableCellClassName}>
                      <Link
                        to="/admin/customers/$customerId"
                        params={{ customerId: customer.id }}
                        className="font-medium text-neutral-900 hover:underline"
                      >
                        {customer.full_name ?? customer.email}
                      </Link>
                      {customer.is_guest && (
                        <span className="ml-2">
                          <Badge tone="neutral">Guest</Badge>
                        </span>
                      )}
                    </td>
                    <td className={`${tableCellClassName} text-neutral-500`}>
                      <p>{customer.email}</p>
                      {customer.phone && <p>{customer.phone}</p>}
                    </td>
                    <td className={`${tableCellClassName} text-right`}>
                      {customer.orders_count}
                    </td>
                    <td className={`${tableCellClassName} text-right`}>
                      {customer.cancelled_orders_count}
                    </td>
                    <td className={`${tableCellClassName} text-right`}>
                      {customer.return_count}
                    </td>
                    <td className={tableCellClassName}>
                      <div className="flex gap-1.5">
                        {customer.is_high_risk && (
                          <Badge tone="warning">High risk</Badge>
                        )}
                        {customer.cod_blocked && (
                          <Badge tone="critical">COD blocked</Badge>
                        )}
                        {!customer.is_high_risk && !customer.cod_blocked && (
                          <span className="text-neutral-400">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
