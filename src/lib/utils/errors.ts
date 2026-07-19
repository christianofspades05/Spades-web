/**
 * Supabase's postgrest-js only wraps `error` in a real `Error` instance when
 * `.throwOnError()` is chained — this codebase instead destructures
 * `{ data, error }` everywhere and does `if (error) throw error`, so the
 * thrown value is normally a plain `{ message, details, hint, code }` object
 * (see postgrest-js's processResponse), not an actual Error. Reading
 * `.message` off either shape is what makes real Postgres errors (e.g. a
 * check-constraint violation) survive here instead of collapsing to the
 * generic fallback below.
 */
function errorMessageOf(err: unknown): string | null {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    return typeof err.message === 'string' ? err.message : null
  }
  return null
}

/**
 * Server function validation failures arrive as a message holding a
 * JSON-stringified array of Zod issues (e.g. `[{"message":"...","path":[...]}]`)
 * rather than plain text. Surfacing that raw JSON to users is the "[{ origin:
 * ... }]" bug — this extracts the first issue's message when present.
 */
export function getErrorMessage(err: unknown): string {
  const message = errorMessageOf(err)
  if (message === null) return 'Something went wrong'

  try {
    const parsed: unknown = JSON.parse(message)
    if (Array.isArray(parsed) && parsed.length > 0) {
      const messages = parsed
        .map((issue) =>
          issue && typeof issue === 'object' && 'message' in issue
            ? String((issue as { message: unknown }).message)
            : null,
        )
        .filter((m): m is string => m !== null)
      if (messages.length > 0) return messages.join(' ')
    }
  } catch {
    // Not JSON — fall through to the raw message.
  }

  return message || 'Something went wrong'
}
