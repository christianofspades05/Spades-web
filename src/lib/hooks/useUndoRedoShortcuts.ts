import { useEffect } from 'react'

/** Cmd/Ctrl+Z to undo, Cmd/Ctrl+Shift+Z to redo — attached at the page level so it works no matter which field is focused. */
export function useUndoRedoShortcuts(undo: () => void, redo: () => void) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() !== 'z') return
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo])
}
