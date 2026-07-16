import { useCallback, useRef, useState } from 'react'

/** Rapid edits within this window (e.g. typing a sentence) collapse into a single undo step. */
const MERGE_WINDOW_MS = 700

/**
 * Page-level undo/redo history for a form's editable state. Native browser
 * undo doesn't reliably follow React-controlled inputs and can't span
 * multiple fields or a single action that touches many fields at once (e.g.
 * a spreadsheet fill-drag) — this tracks one linear history for the whole
 * form instead.
 */
export function useUndoableState<T>(initial: T) {
  const [state, setStateRaw] = useState(initial)
  const historyRef = useRef<T[]>([initial])
  const indexRef = useRef(0)
  const lastSetAtRef = useRef(0)

  const set = useCallback((next: T) => {
    const now = Date.now()
    const atTip = indexRef.current === historyRef.current.length - 1
    const withinMergeWindow = now - lastSetAtRef.current < MERGE_WINDOW_MS
    lastSetAtRef.current = now

    if (atTip && withinMergeWindow) {
      historyRef.current[indexRef.current] = next
    } else {
      historyRef.current = [
        ...historyRef.current.slice(0, indexRef.current + 1),
        next,
      ]
      indexRef.current = historyRef.current.length - 1
    }
    setStateRaw(next)
  }, [])

  const undo = useCallback(() => {
    if (indexRef.current === 0) return
    indexRef.current -= 1
    lastSetAtRef.current = 0
    setStateRaw(historyRef.current[indexRef.current])
  }, [])

  const redo = useCallback(() => {
    if (indexRef.current >= historyRef.current.length - 1) return
    indexRef.current += 1
    lastSetAtRef.current = 0
    setStateRaw(historyRef.current[indexRef.current])
  }, [])

  return {
    value: state,
    set,
    undo,
    redo,
    canUndo: indexRef.current > 0,
    canRedo: indexRef.current < historyRef.current.length - 1,
  }
}
