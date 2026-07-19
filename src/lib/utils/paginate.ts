// PostgREST caps an unbounded select at 1000 rows by default. Any query over
// a table that can plausibly exceed that (orders, order_items, shipments,
// storefront_visits, ...) needs to page through results explicitly, or it
// silently truncates with no error — undercounting whatever total depends
// on it.
export async function fetchAllRows<T>(
  buildPage: (offset: number) => PromiseLike<{
    data: T[] | null
    error: { message: string } | null
  }>,
): Promise<T[]> {
  const all: T[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await buildPage(offset)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < 1000) break
  }
  return all
}
