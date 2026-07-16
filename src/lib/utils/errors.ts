/**
 * Server function validation failures arrive as `Error.message` holding a
 * JSON-stringified array of Zod issues (e.g. `[{"message":"...","path":[...]}]`)
 * rather than plain text. Surfacing that raw JSON to users is the "[{ origin:
 * ... }]" bug — this extracts the first issue's message when present.
 */
export function getErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Something went wrong'

  try {
    const parsed: unknown = JSON.parse(err.message)
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

  return err.message || 'Something went wrong'
}
