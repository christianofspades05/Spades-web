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

// PostgREST's `.in()` filter also has a practical query-string-length limit
// — a large id list (hundreds+) can get rejected the same way an unbounded
// select can. Splitting into chunks keeps each request well under that.
export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}
